import type { Transaction } from '@/types'

/** Last date (YYYY-MM-DD) a credit card with this billing day cut off, on or before
 * today -- JS mirror of account_service._last_occurrence (same end-of-month clamp).
 * Comparing dates as ISO strings instead of Date avoids the timezone offset from
 * `new Date("YYYY-MM-DD")` (parsed as midnight UTC, not local). */
export function lastCycleBoundary(billingCycleDay: number, today: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate()
  let year = today.getFullYear()
  let month = today.getMonth()
  let day = Math.min(billingCycleDay, daysInMonth(year, month))
  const todayStr = `${year}-${pad(month + 1)}-${pad(today.getDate())}`
  let candidate = `${year}-${pad(month + 1)}-${pad(day)}`
  if (candidate > todayStr) {
    month -= 1
    if (month < 0) {
      month = 11
      year -= 1
    }
    day = Math.min(billingCycleDay, daysInMonth(year, month))
    candidate = `${year}-${pad(month + 1)}-${pad(day)}`
  }
  return candidate
}

/** Interest-free installment purchases (MSI) that still have installments to pay. */
export function activeInstallmentPlans(transactions: Transaction[]): Transaction[] {
  return transactions.filter(
    (tx) => tx.installment && tx.installment.paid_installments < tx.installment.total_installments,
  )
}

/** What is still to be paid of an installment plan: installments left x monthly amount. */
export function remainingOfPlan(tx: Transaction): number {
  const info = tx.installment
  if (!info) return 0
  return Math.max(info.total_installments - info.paid_installments, 0) * Number(info.monthly_amount)
}

/** The card's plain expenses since its last cutoff (newest first), without the installment
 * purchases (those are represented by their monthly amount) nor payments. */
export function openCycleCharges(transactions: Transaction[], boundary: string | null): Transaction[] {
  if (!boundary) return []
  return transactions
    .filter((tx) => tx.entry_type === 'expense' && !tx.installment && tx.date > boundary)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

/** One color per installment plan so each progress bar reads on its own (token pairs from
 * index.css: the bar uses the base color, the amounts the "-ink" one that stays readable in
 * light mode). Shared by the card commitments (Recurrentes) and the installments panel (Cuentas). */
export const PLAN_TONES = [
  { bar: 'var(--nl-violet)', ink: 'var(--nl-violet-ink)', soft: 'var(--nl-violet-soft-bg)' },
  { bar: 'var(--nl-blue)', ink: 'var(--nl-blue-ink)', soft: 'var(--nl-blue-soft-bg)' },
  { bar: 'var(--nl-pink)', ink: 'var(--nl-pink)', soft: 'var(--nl-bg-track)' },
  { bar: 'var(--nl-accent)', ink: 'var(--nl-accent-ink)', soft: 'var(--nl-accent-soft-bg)' },
]
