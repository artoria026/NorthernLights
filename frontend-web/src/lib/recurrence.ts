import { addMonths, addWeeks, addYears, isAfter, isBefore, parseISO } from 'date-fns'
import type { PaymentFrequency, RecurringFrequency } from '@/types'

/** Mirrors `compute_next_date` in `recurring_service.py` -- if one changes,
 * change the other. */
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

/** Mirrors `_advance_date` in `debt_service.py`. `irregular` (or no
 * frequency) cannot be projected forward. */
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

/** The backend only stores the *next* date of each recurring item/debt
 * (it advances when that occurrence is confirmed), not every future
 * occurrence. To render a full month in the calendar we project forward
 * from that date using the same frequency rule the backend uses. */
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
