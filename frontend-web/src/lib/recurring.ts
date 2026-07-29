import type { AlertUrgency, RecurringFrequency, RecurringItem, RecurringItemType } from '@/types'

export const ITEM_TYPE_LABELS: Record<RecurringItemType, string> = {
  subscription: 'Suscripción',
  service: 'Servicio',
  utility: 'Servicio esencial',
  income: 'Ingreso',
}

export const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
  bimonthly: 'Bimestral',
  annual: 'Anual',
}

export const STATUS_LABELS: Record<RecurringItem['status'], string> = {
  active: 'Activa',
  paused: 'Pausada',
  cancelled: 'Cancelada',
}

export const URGENCY_LABELS: Record<AlertUrgency, string> = {
  normal: 'Normal',
  high: 'Alta',
  critical: 'Crítica',
}

const FREQUENCY_FACTORS: Record<RecurringFrequency, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  monthly: 1,
  bimonthly: 1 / 2,
  annual: 1 / 12,
}

/** Mismo factor que `recurring_service.monthly_equivalent` en el backend --
 * solo para mostrar un estimado en la UI, el backend es la fuente de verdad
 * para cualquier calculo que afecte presupuesto real. */
export function monthlyEquivalent(amount: string, frequency: RecurringFrequency): number {
  return Number(amount) * FREQUENCY_FACTORS[frequency]
}
