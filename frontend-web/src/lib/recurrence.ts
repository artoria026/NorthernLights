import { addMonths, addWeeks, addYears, isAfter, isBefore, parseISO } from 'date-fns'
import type { PaymentFrequency, RecurringFrequency } from '@/types'

/** Espeja `compute_next_date` en `recurring_service.py` -- si cambia una,
 * cambia la otra. */
export function advanceRecurringDate(current: Date, frequency: RecurringFrequency): Date {
  switch (frequency) {
    case 'weekly':
      return addWeeks(current, 1)
    case 'biweekly':
      return addWeeks(current, 2)
    case 'monthly':
      return addMonths(current, 1)
    case 'bimonthly':
      return addMonths(current, 2)
    case 'annual':
      return addYears(current, 1)
  }
}

/** Espeja `_advance_date` en `debt_service.py`. `irregular` (o sin
 * frecuencia) no se puede proyectar hacia adelante. */
export function advanceDebtDate(current: Date, frequency: PaymentFrequency | null): Date | null {
  switch (frequency) {
    case 'weekly':
      return addWeeks(current, 1)
    case 'biweekly':
      return addWeeks(current, 2)
    case 'monthly':
      return addMonths(current, 1)
    default:
      return null
  }
}

/** El backend solo guarda la *proxima* fecha de cada item recurrente/deuda
 * (avanza cuando se confirma esa ocurrencia), no cada ocurrencia futura. Para
 * pintar un mes completo en el calendario proyectamos hacia adelante desde
 * esa fecha usando la misma regla de frecuencia que usa el backend. */
export function projectOccurrences(
  startDateIso: string,
  advance: (current: Date) => Date | null,
  rangeStart: Date,
  rangeEnd: Date,
  maxIterations = 104,
): Date[] {
  const results: Date[] = []
  let current: Date | null = parseISO(startDateIso)
  let iterations = 0

  while (current && !isAfter(current, rangeEnd) && iterations < maxIterations) {
    if (!isBefore(current, rangeStart)) {
      results.push(current)
    }
    current = advance(current)
    iterations++
  }

  return results
}
