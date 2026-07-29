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
import { es } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Legend } from '@/components/nl/primitives'
import { useDebts } from '@/hooks/useDebts'
import { useRecurringItems } from '@/hooks/useRecurring'
import { useTransactions } from '@/hooks/useTransactions'
import { advanceDebtDate, advanceRecurringDate, projectOccurrences } from '@/lib/recurrence'
import { formatMoney } from '@/lib/utils'

interface UpcomingEntry {
  label: string
  amount: string
}

/** Mini-calendario dentro de Transacciones -- complementa la lista (no la
 * reemplaza): puntos verdes/rojos marcan dias con movimientos reales, un
 * punto ambar marca pagos proximos que aun no se registran. Click en un dia
 * filtra la tabla de la izquierda (el padre controla `selectedDate` via
 * dateFrom/dateTo, aqui no vive estado de seleccion). */
export function TransactionsCalendar({
  selectedDate,
  onSelectDate,
}: {
  selectedDate: string | null
  onSelectDate: (date: string | null) => void
}) {
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
        <h2 className="text-xs font-medium capitalize">{format(cursor, 'MMMM yyyy', { locale: es })}</h2>
        <button
          type="button"
          onClick={() => setCursor((c) => addMonths(c, 1))}
          className="p-1 rounded-md border border-border text-muted-foreground hover:text-foreground"
        >
          <ChevronRight size={13} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-px rounded-md overflow-hidden border border-border" style={{ background: 'var(--nl-border)' }}>
        {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => (
          <div key={d} className="bg-card text-center text-[9px] text-muted-foreground py-1">
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

          const tooltipLines = [format(day, "d 'de' MMMM", { locale: es })]
          if (stats?.income) tooltipLines.push(`+${formatMoney(stats.income)} ingresos`)
          if (stats?.expense) tooltipLines.push(`-${formatMoney(stats.expense)} gastos`)
          if (stats?.other) tooltipLines.push(`${formatMoney(stats.other)} otros movimientos`)
          for (const item of dayUpcoming) tooltipLines.push(`${item.label} (próximo, ${formatMoney(Number(item.amount))})`)

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
            { label: 'Ingreso', color: 'var(--nl-accent)' },
            { label: 'Gasto', color: 'var(--nl-danger)' },
            { label: 'Próximo', color: 'var(--nl-warning)' },
          ]}
        />
      </div>

      {selectedDate && (
        <button
          type="button"
          onClick={() => onSelectDate(null)}
          className="mt-2.5 w-full rounded px-2.5 py-1.5 text-[11px] border border-border text-muted-foreground hover:text-foreground"
        >
          Quitar filtro de fecha
        </button>
      )}
    </div>
  )
}
