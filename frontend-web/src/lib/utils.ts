import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Transaction } from "@/types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Amounts from the backend usually arrive as a string (serialized
 * Decimal) -- String.prototype.toLocaleString silently ignores currency
 * options, which is why the Number() here is mandatory and not cosmetic. */
export function formatMoney(
  value: string | number | null | undefined,
  opts?: { maximumFractionDigits?: number },
): string {
  return Number(value ?? 0).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: opts?.maximumFractionDigits,
  })
}

/** Red if negative, green if positive, no color (normal text) at zero --
 * so as not to force a "false" green on an amount that's actually $0. Same
 * criteria across the whole app: account balance, net worth, weekly
 * available, etc. */
export function amountColor(value: string | number | null | undefined): string | undefined {
  const n = Number(value ?? 0)
  if (n < 0) return "var(--nl-danger-ink)"
  if (n > 0) return "var(--nl-accent-ink)"
  return undefined
}

/** Balance of an account -- for a liability (credit card) amountColor used
 * to paint it "positive" green just because the number is > 0, implying
 * it's money in your favor when it's actually what you owe. A liability is
 * shown in neutral blue regardless of sign; the rest of the account types
 * keep amountColor's normal criteria. */
export function accountBalanceColor(account: { type: string; balance: string }): string | undefined {
  if (account.type === "liability") return "var(--nl-blue-ink)"
  return amountColor(account.balance)
}

/** Native select with the same visual treatment as <Input> (there's no
 * shadcn/select component in this project; centralized here to avoid
 * repeating the long class on every page). */
export const selectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"

/** Spanish label for entry_type -- used as a fallback when a transaction
 * has no category_name (transfers/loans don't carry a category). */
const ENTRY_TYPE_LABELS: Record<string, string> = {
  expense: "Gasto",
  income: "Ingreso",
  transfer: "Transferencia",
  loan_received: "Préstamo recibido",
  loan_repayment: "Pago de préstamo",
  loan_given: "Préstamo otorgado",
  loan_collection: "Cobro de préstamo",
  // Same label for both directions on purpose (chosen with the user) --
  // the amount's color already distinguishes in/out, see
  // isPositiveEntryType.
  adjustment_in: "Ajuste de saldo",
  adjustment_out: "Ajuste de saldo",
}

export function entryTypeLabel(entryType: string): string {
  return ENTRY_TYPE_LABELS[entryType] ?? entryType
}

/** entry_types that add to the account balance (shown in green) -- used
 * instead of comparing `=== 'income'` by hand on every screen, now that
 * adjustment_in also counts as an "entry" just like income. */
export function isPositiveEntryType(entryType: string): boolean {
  return entryType === "income" || entryType === "adjustment_in"
}

/** Only expense/income/transfer with exactly 2 lines are editable from
 * EditTransactionModal -- loans, adjustments and split expenses (>2 lines)
 * have their own dedicated flows (Debts, Reconcile account, split expense)
 * and editing them generically would be incorrect without additional logic
 * that wasn't requested. */
export function isTransactionEditable(tx: Transaction): boolean {
  return (
    (tx.entry_type === "expense" || tx.entry_type === "income" || tx.entry_type === "transfer") &&
    tx.lines.length === 2
  )
}

/** Spanish label for an account's subtype/type (AccountCreate.subtype in
 * the backend) -- same pattern as ENTRY_TYPE_LABELS above. */
const ACCOUNT_SUBTYPE_LABELS: Record<string, string> = {
  cash: "Efectivo",
  checking: "Cuenta de débito",
  savings: "Cuenta de ahorro",
  credit_card: "Tarjeta de crédito",
  payroll_loan: "Crédito de nómina",
  personal_loan: "Préstamo personal",
  store_credit: "Crédito departamental",
  informal_debt: "Deuda informal",
  loan_payable: "Préstamo por pagar",
  loan_receivable: "Préstamo por cobrar",
  installment: "Meses sin intereses",
  civic: "Crédito cívico",
}

export function accountSubtypeLabel(subtype: string | null | undefined): string {
  if (!subtype) return ""
  return ACCOUNT_SUBTYPE_LABELS[subtype] ?? subtype
}

/** Spanish label for Debt.type -- same pattern as ACCOUNT_SUBTYPE_LABELS. */
const DEBT_TYPE_LABELS: Record<string, string> = {
  personal_loan: "Préstamo personal",
  payroll_loan: "Crédito de nómina",
  informal: "Préstamo informal",
  civic: "Crédito cívico",
  loan_received: "Préstamo recibido",
}

export function debtTypeLabel(type: string): string {
  return DEBT_TYPE_LABELS[type] ?? type
}

/** Spanish label for PaymentFrequency (debts) -- different from
 * FREQUENCY_LABELS in lib/recurring.ts because it includes "irregular" and
 * not "bimonthly"/"annual" (those are only for recurring items, not debts). */
const PAYMENT_FREQUENCY_LABELS: Record<string, string> = {
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual",
  irregular: "Irregular",
}

export function paymentFrequencyLabel(frequency: string): string {
  return PAYMENT_FREQUENCY_LABELS[frequency] ?? frequency
}

/** "2026-08-25" -> "25 ago" -- for narrow columns where the full ISO date
 * doesn't fit (see Recurring.tsx/Subscriptions.tsx, "upcoming
 * payments/renewals" lists). No year on purpose: these lists only show
 * dates within the next 7 days, never crossing a year boundary. timeZone:
 * 'UTC' because the input string carries no time -- without this, in
 * negative time zones (UTC-N) the shown day shifts one day back. */
export function formatShortDate(value: string): string {
  return new Date(value).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
}
