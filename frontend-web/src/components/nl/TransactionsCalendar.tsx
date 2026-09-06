import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import { enUS, es } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Legend } from '@/components/nl/primitives'
import { useDebts } from '@/hooks/useDebts'
import { useRecurringItems } from '@/hooks/useRecurring'
import { useTransactions } from '@/hooks/useTransactions'
import i18n from '@/lib/i18n'
import { advanceDebtDate, advanceRecurringDate, projectOccurrences } from '@/lib/recurrence'
import { formatMoney } from '@/lib/utils'

interface UpcomingEntry {
  label: string
  amount: string
}

/** Mini calendar inside Transacciones -- complements the list (doesn't
 * replace it): green/red dots mark days with real transactions, an amber
 * dot marks upcoming payments that haven't been recorded yet. Clicking a
 * day filters the table on the left (the parent controls `selectedDate`
 * via dateFrom/dateTo, no selection state lives here). */
export function TransactionsCalendar({
  selectedDate,
  onSelectDate,
}: {
  selectedDate: string | null
  onSelectDate: (date: string | null) => void
}) {
  const { t } = useTranslation('common')
  const weekdayLabels = t('transactionsCalendar.weekdays', { returnObjects: true }) as string[]
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()))

  const monthStart = startOfMonth(cursor)
  const monthEnd = endOfMonth(cursor)
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const days = useMemo(() => eachDayOfInterval({ start: gridStart, end: gridEnd }), [gridStart, gridEnd])

  const { data: txData } = useTransactions({
    date_from: format(monthStart, 'yyyy-MM-dd'),
    date_to: format(monthEnd, 'yyyy-MM-dd'),
    per_page: 100,
  })
  const { data: recurringItems } = useRecurringItems({ status: 'active' })
  const { data: debts } = useDebts()

  const dayStats = useMemo(() => {
    const map = new Map<string, { income: number; expense: number; other: number }>()
    for (const tx of txData?.data ?? []) {
      if (tx.status === 'rejected') continue
      const entry = map.get(tx.date) ?? { income: 0, expense: 0, other: 0 }
      const amount = Number(tx.amount ?? 0)
      if (tx.entry_type === 'income') entry.income += amount
      else if (tx.entry_type === 'expense') entry.expense += amount
      else entry.other += amount
      map.set(tx.date, entry)
    }
    return map
  }, [txData])

  const upcomingByDay = useMemo(() => {
    const map = new Map<string, UpcomingEntry[]>()
    const push = (key: string, entry: UpcomingEntry) => {
      const list = map.get(key) ?? []
      list.push(entry)
      map.set(key, list)
    }
    for (const item of recurringItems ?? []) {
      if (item.status !== 'active') continue
      const occurrences = projectOccurrences(
        item.next_date,
        (d) => advanceRecurringDate(d, item.frequency),
        gridStart,
        gridEnd,
      )
      for (const occ of occurrences) {
        push(format(occ, 'yyyy-MM-dd'), { label: item.name, amount: item.amount })
      }
    }
    for (const debt of debts ?? []) {
      if (debt.status !== 'active' || !debt.next_payment_date) continue
      const occurrences = projectOccurrences(
        debt.next_payment_date,
        (d) => advanceDebtDate(d, debt.payment_frequency),
        gridStart,
        gridEnd,
      )
      for (const occ of occurrences) {
        push(format(occ, 'yyyy-MM-dd'), { label: debt.name, amount: debt.payment_amount ?? '0' })
      }
    }
    return map
  }, [recurringItems, debts, gridStart, gridEnd])

  return (
    <div>
      <div className="flex items-center justify-between mb-2.5">
        <button
          type="button"
          onClick={() => setCursor((c) => subMonths(c, 1))}
          className="p-1 rounded-md border border-border text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft size={13} />
        </button>
        <h2 className="text-xs font-medium capitalize">
          {format(cursor, 'MMMM yyyy', { locale: i18n.language === 'en' ? enUS : es })}
        </h2>
        <button
          type="button"
          onClick={() => setCursor((c) => addMonths(c, 1))}
          className="p-1 rounded-md border border-border text-muted-foreground hover:text-foreground"
        >
          <ChevronRight size={13} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-px rounded-md overflow-hidden border border-border" style={{ background: 'var(--nl-border)' }}>
        {weekdayLabels.map((d, i) => (
          <div key={i} className="bg-card text-center text-[9px] text-muted-foreground py-1">
            {d}
          </div>
        ))}
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd')
          const stats = dayStats.get(key)
          const dayUpcoming = upcomingByDay.get(key) ?? []
          const inMonth = isSameMonth(day, cursor)
          const today = isToday(day)
          const isSelected = selectedDate === key

          const tooltipLines = [
            i18n.language === 'en'
              ? format(day, 'MMMM d', { locale: enUS })
              : format(day, "d 'de' MMMM", { locale: es }),
          ]
          if (stats?.income) tooltipLines.push(t('transactionsCalendar.tooltip.income', { amount: formatMoney(stats.income) }))
          if (stats?.expense) tooltipLines.push(t('transactionsCalendar.tooltip.expense', { amount: formatMoney(stats.expense) }))
          if (stats?.other) tooltipLines.push(t('transactionsCalendar.tooltip.other', { amount: formatMoney(stats.other) }))
          for (const item of dayUpcoming)
            tooltipLines.push(
              t('transactionsCalendar.tooltip.upcoming', { label: item.label, amount: formatMoney(Number(item.amount)) }),
            )

          return (
            <button
              key={key}
              type="button"
              title={tooltipLines.join('\n')}
              onClick={() => onSelectDate(isSelected ? null : key)}
              className={`bg-card flex flex-col items-center justify-start gap-1 py-1.5 min-h-[36px] transition-colors ${
                inMonth ? '' : 'opacity-30'
              } ${isSelected ? '' : 'hover:bg-accent'}`}
              style={isSelected ? { background: 'var(--nl-bg-hover)', boxShadow: 'inset 0 0 0 1px var(--nl-accent)' } : undefined}
            >
              <span
                className={`text-[10px] w-4 h-4 flex items-center justify-center rounded-full ${today ? 'font-semibold' : 'text-muted-foreground'}`}
                style={today ? { background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' } : undefined}
              >
                {format(day, 'd')}
              </span>
              <span className="flex items-center gap-0.5 h-1.5">
                {!!stats?.income && <span className="w-1 h-1 rounded-full" style={{ background: 'var(--nl-accent)' }} />}
                {!!stats?.expense && <span className="w-1 h-1 rounded-full" style={{ background: 'var(--nl-danger)' }} />}
                {dayUpcoming.length > 0 && (
                  <span className="w-1 h-1 rounded-full" style={{ background: 'var(--nl-warning)' }} />
                )}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-2.5">
        <Legend
          items={[
            { label: t('transactionsCalendar.legend.income'), color: 'var(--nl-accent)' },
            { label: t('transactionsCalendar.legend.expense'), color: 'var(--nl-danger)' },
            { label: t('transactionsCalendar.legend.upcoming'), color: 'var(--nl-warning)' },
          ]}
        />
      </div>

      {selectedDate && (
        <button
          type="button"
          onClick={() => onSelectDate(null)}
          className="mt-2.5 w-full rounded px-2.5 py-1.5 text-[11px] border border-border text-muted-foreground hover:text-foreground"
        >
          {t('transactionsCalendar.clearDateFilterButton')}
        </button>
      )}
    </div>
  )
}
