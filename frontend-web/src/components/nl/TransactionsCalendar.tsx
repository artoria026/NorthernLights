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
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
 * day filters the table on the left, and pressing a day and dragging over others
 * selects the whole range (the parent controls `selectedRange` via
 * dateFrom/dateTo; the only selection state kept here is the drag in progress). */
/** How "hot" a day is by what was spent on it (0 = nothing, 4 = a lot): the tint of its cell. */
export function heatLevel(expense: number): 0 | 1 | 2 | 3 | 4 {
  if (expense >= 1500) return 4
  if (expense >= 500) return 3
  if (expense >= 200) return 2
  return expense > 0 ? 1 : 0
}

const HEAT_MIX = ['0%', '12%', '24%', '38%', '55%'] as const

function heatBackground(level: number): string | undefined {
  if (level === 0) return undefined
  return `linear-gradient(160deg, color-mix(in srgb, var(--nl-danger) ${HEAT_MIX[level]}, var(--nl-bg-input)), var(--nl-bg-card))`
}

export interface DateRange {
  from: string
  to: string
}

export function TransactionsCalendar({
  selectedRange,
  onSelectRange,
}: {
  selectedRange: DateRange | null
  onSelectRange: (range: DateRange | null) => void
}) {
  const { t } = useTranslation('common')
  const weekdayLabels = t('transactionsCalendar.weekdays', { returnObjects: true }) as string[]
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()))
  // The range being dragged (ISO dates, so they compare as text). While it exists it is what the
  // grid shows; the filter only changes when the mouse/finger is released.
  const [drag, setDrag] = useState<DateRange | null>(null)
  const dragRef = useRef<{ anchor: string; range: DateRange } | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const onSelectRangeRef = useRef(onSelectRange)
  onSelectRangeRef.current = onSelectRange
  const selectedRangeRef = useRef(selectedRange)
  selectedRangeRef.current = selectedRange

  const orderedRange = (a: string, b: string): DateRange => (a <= b ? { from: a, to: b } : { from: b, to: a })

  function startDrag(key: string) {
    dragRef.current = { anchor: key, range: { from: key, to: key } }
    setDrag({ from: key, to: key })
  }

  function extendDrag(key: string) {
    const current = dragRef.current
    if (!current) return
    const range = orderedRange(current.anchor, key)
    dragRef.current = { ...current, range }
    setDrag(range)
  }

  // Released anywhere (even outside the calendar): a press on one day is a click -- it toggles that
  // day -- and a drag over several selects the whole range.
  useEffect(() => {
    function finish() {
      const current = dragRef.current
      if (!current) return
      dragRef.current = null
      setDrag(null)
      const { from, to } = current.range
      const selected = selectedRangeRef.current
      const sameSingleDay = selected && selected.from === from && selected.to === to && from === to
      onSelectRangeRef.current(sameSingleDay ? null : { from, to })
    }
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    return () => {
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
  }, [])

  // A finger does not fire pointerenter on the cells it slides over: find the day under it.
  function onGridPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return
    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-day]')
    if (cell?.dataset.day) extendDrag(cell.dataset.day)
  }

  const shownRange = drag ?? selectedRange

  const monthStart = startOfMonth(cursor)
  const monthEnd = endOfMonth(cursor)
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const days = useMemo(() => eachDayOfInterval({ start: gridStart, end: gridEnd }), [gridStart, gridEnd])

  const { data: txData } = useTransactions({
    date_from: format(monthStart, 'yyyy-MM-dd'),
    date_to: format(monthEnd, 'yyyy-MM-dd'),
    // 500 is the most a page gives: a busy month (150+ expenses) must not lose days' dots.
    per_page: 500,
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

      <div
        ref={gridRef}
        onPointerMove={onGridPointerMove}
        className="grid grid-cols-7 gap-[3px] select-none touch-none"
      >
        {weekdayLabels.map((d, i) => (
          <div key={i} className="text-center text-[9px] text-muted-foreground py-1">
            {d}
          </div>
        ))}
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd')
          const stats = dayStats.get(key)
          const dayUpcoming = upcomingByDay.get(key) ?? []
          const inMonth = isSameMonth(day, cursor)
          const today = isToday(day)
          const heat = heatLevel(stats?.expense ?? 0)
          const hasIncome = !!stats?.income
          const hasUpcoming = dayUpcoming.length > 0
          const inRange = !!shownRange && key >= shownRange.from && key <= shownRange.to
          const isRangeStart = inRange && key === shownRange?.from
          const isRangeEnd = inRange && key === shownRange?.to
          const isMultiRange = !!shownRange && shownRange.from !== shownRange.to

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
              data-day={key}
              data-heat={heat}
              data-income={hasIncome || undefined}
              data-upcoming={hasUpcoming || undefined}
              aria-pressed={inRange}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.preventDefault()
                startDrag(key)
              }}
              onPointerEnter={() => extendDrag(key)}
              // Keyboard (Enter/Space) arrives as a click without a pointer: it toggles the day.
              onClick={(e) => {
                if (e.detail !== 0) return
                const single = selectedRange && selectedRange.from === key && selectedRange.to === key
                onSelectRange(single ? null : { from: key, to: key })
              }}
              // "Calor de cristal": a glass card tinted red by what was spent that day, with a bright
              // green line on top when money came in. Hover lifts it with a soft glow; the selected
              // days get an accent frame (the middle of a range loses its rounded corners so it reads
              // as one band).
              className={`relative overflow-hidden flex flex-col items-center justify-start gap-1 py-1.5 min-h-[36px] rounded-[10px] border transition-all duration-150 ${
                inMonth ? '' : 'opacity-30'
              } ${
                inRange
                  ? 'border-[var(--nl-accent)] shadow-[0_0_0_1px_var(--nl-accent),0_6px_16px_-6px_color-mix(in_srgb,var(--nl-accent)_60%,transparent)]'
                  : 'border-border hover:-translate-y-0.5 hover:border-[var(--nl-accent)] hover:shadow-[0_5px_14px_-5px_color-mix(in_srgb,var(--nl-accent)_55%,transparent)]'
              } ${isMultiRange && inRange && !isRangeStart && !isRangeEnd ? 'rounded-[4px]' : ''}`}
              style={{ background: heatBackground(heat) ?? 'linear-gradient(160deg, var(--nl-bg-input), var(--nl-bg-card))' }}
            >
              {hasIncome && (
                <span
                  aria-hidden="true"
                  className="absolute left-[18%] right-[18%] top-0 h-0.5 rounded-full"
                  style={{ background: 'var(--nl-accent)', boxShadow: '0 0 8px var(--nl-accent)' }}
                />
              )}
              <span
                className={`text-[10px] w-4 h-4 flex items-center justify-center rounded-full ${today ? 'font-semibold' : 'text-muted-foreground'} ${inRange ? 'text-foreground' : ''}`}
                style={{
                  ...(today ? { background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' } : {}),
                  // Upcoming payment: the "brasas" ring around the day number.
                  ...(hasUpcoming ? { boxShadow: '0 0 0 2px var(--nl-warning)' } : {}),
                }}
              >
                {format(day, 'd')}
              </span>
              <span className="h-1.5" aria-hidden="true" />
            </button>
          )
        })}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-0.5 w-3 rounded-full"
            style={{ background: 'var(--nl-accent)', boxShadow: '0 0 6px var(--nl-accent)' }}
          />
          {t('transactionsCalendar.legend.income')}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-1.5 w-4 rounded-sm"
            style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--nl-danger) 12%, var(--nl-bg-input)), var(--nl-danger))' }}
          />
          {t('transactionsCalendar.legend.expense')}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ boxShadow: 'inset 0 0 0 2px var(--nl-warning)' }} />
          {t('transactionsCalendar.legend.upcoming')}
        </span>
      </div>

      {selectedRange && (
        <button
          type="button"
          onClick={() => onSelectRange(null)}
          className="mt-2.5 w-full rounded px-2.5 py-1.5 text-[11px] border border-border text-muted-foreground hover:text-foreground"
        >
          {t('transactionsCalendar.clearDateFilterButton')}
        </button>
      )}
    </div>
  )
}
