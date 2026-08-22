import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Transaction } from "@/types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Los montos del backend suelen llegar como string (Decimal serializado) --
 * String.prototype.toLocaleString ignora silenciosamente las opciones de
 * moneda, por eso el Number() es obligatorio aqui y no cosmetico. */
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

/** Rojo si es negativo, verde si es positivo, sin color (texto normal) en
 * cero -- para no forzar un verde "falso" en un monto que en realidad es
 * $0. Mismo criterio en toda la app: saldo de cuenta, patrimonio neto,
 * disponible de la semana, etc. */
export function amountColor(value: string | number | null | undefined): string | undefined {
  const n = Number(value ?? 0)
  if (n < 0) return "var(--nl-danger-ink)"
  if (n > 0) return "var(--nl-accent-ink)"
  return undefined
}

/** Saldo de una cuenta -- para un pasivo (TDC) amountColor lo pintaba verde
 * "positivo" solo porque el numero es > 0, dando a entender que es dinero a
 * tu favor cuando en realidad es lo que debes. Un pasivo se muestra en azul
 * neutro sin importar el signo; el resto de tipos de cuenta conserva el
 * criterio normal de amountColor. */
export function accountBalanceColor(account: { type: string; balance: string }): string | undefined {
  if (account.type === "liability") return "var(--nl-blue-ink)"
  return amountColor(account.balance)
}

/** Select nativo con el mismo tratamiento visual que <Input> (no hay un
 * componente shadcn/select en este proyecto; se centraliza aqui para no
 * repetir la clase larga en cada pagina). */
export const selectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"

/** Etiqueta en espanol para entry_type -- usada como respaldo cuando una
 * transaccion no tiene category_name (transfer/prestamos no llevan categoria). */
const ENTRY_TYPE_LABELS: Record<string, string> = {
  expense: "Gasto",
  income: "Ingreso",
  transfer: "Transferencia",
  loan_received: "Préstamo recibido",
  loan_repayment: "Pago de préstamo",
  loan_given: "Préstamo otorgado",
  loan_collection: "Cobro de préstamo",
  // Misma etiqueta para ambas direcciones a propósito (elegido con el
  // usuario) -- el color del monto ya distingue entrada/salida, ver
  // isPositiveEntryType.
  adjustment_in: "Ajuste de saldo",
  adjustment_out: "Ajuste de saldo",
}

export function entryTypeLabel(entryType: string): string {
  return ENTRY_TYPE_LABELS[entryType] ?? entryType
}

/** entry_type que suman al balance de la cuenta (se muestran en verde) --
 * usado en vez de comparar `=== 'income'` a mano en cada pantalla, ahora que
 * adjustment_in tambien cuenta como "entrada" igual que income. */
export function isPositiveEntryType(entryType: string): boolean {
  return entryType === "income" || entryType === "adjustment_in"
}

/** Solo expense/income/transfer con exactamente 2 lines son editables desde
 * EditTransactionModal -- loans, adjustments y gastos divididos (>2 lines)
 * tienen sus propios flujos dedicados (Deudas, Reconciliar cuenta, gasto
 * dividido) y editarlos de forma generica seria incorrecto sin logica
 * adicional que no se pidio. */
export function isTransactionEditable(tx: Transaction): boolean {
  return (
    (tx.entry_type === "expense" || tx.entry_type === "income" || tx.entry_type === "transfer") &&
    tx.lines.length === 2
  )
}

/** Etiqueta en espanol para el subtype/type de una cuenta (AccountCreate.subtype
 * en el backend) -- mismo patron que ENTRY_TYPE_LABELS arriba. */
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

/** Etiqueta en espanol para Debt.type -- mismo patron que ACCOUNT_SUBTYPE_LABELS. */
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

/** Etiqueta en espanol para PaymentFrequency (deudas) -- distinto de
 * FREQUENCY_LABELS en lib/recurring.ts porque incluye "irregular" y no
 * "bimonthly"/"annual" (esos son solo de recurring items, no de deudas). */
const PAYMENT_FREQUENCY_LABELS: Record<string, string> = {
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual",
  irregular: "Irregular",
}

export function paymentFrequencyLabel(frequency: string): string {
  return PAYMENT_FREQUENCY_LABELS[frequency] ?? frequency
}

/** "2026-08-25" -> "25 ago" -- para columnas angostas donde la fecha ISO
 * completa no cabe (ver Recurring.tsx/Subscriptions.tsx, listas de "próximos
 * pagos/renovaciones"). Sin año a propósito: estas listas solo muestran
 * fechas dentro de los próximos 7 días, nunca cruzan de año. timeZone: 'UTC'
 * porque el string de entrada no trae hora -- sin esto, en zonas horarias
 * negativas (UTC-N) el dia mostrado se recorre uno hacia atrás. */
export function formatShortDate(value: string): string {
  return new Date(value).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
}
