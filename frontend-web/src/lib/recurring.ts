import i18n from './i18n'
import type { AlertUrgency, RecurringFrequency, RecurringItem, RecurringItemType } from '@/types'

/** Translated on access via a Proxy (instead of a function) so existing
 * bracket-access call sites (`FREQUENCY_LABELS[f]`) across the app keep
 * working unchanged and stay reactive to the active language. Not
 * enumerable -- nothing in this codebase iterates these with Object.keys,
 * callers use their own ITEM_TYPES/FREQUENCIES arrays for that. */
function labelProxy(nsKey: string): Record<string, string> {
  return new Proxy(
    {},
    {
      get(_target, prop: string) {
        return i18n.t(`${nsKey}.${prop}`, { ns: 'common', defaultValue: prop })
      },
    },
  )
}

export const ITEM_TYPE_LABELS: Record<RecurringItemType, string> = labelProxy('itemTypeLabels')
export const FREQUENCY_LABELS: Record<RecurringFrequency, string> = labelProxy('frequencyLabels')
export const STATUS_LABELS: Record<RecurringItem['status'], string> = labelProxy('statusLabels')
export const URGENCY_LABELS: Record<AlertUrgency, string> = labelProxy('urgencyLabels')

const FREQUENCY_FACTORS: Record<RecurringFrequency, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  monthly: 1,
  bimonthly: 1 / 2,
  annual: 1 / 12,
}

/** Same factor as `recurring_service.monthly_equivalent` in the backend --
 * only to show an estimate in the UI, the backend is the source of truth
 * for any calculation that affects the real budget. */
export function monthlyEquivalent(amount: string, frequency: RecurringFrequency): number {
  return Number(amount) * FREQUENCY_FACTORS[frequency]
}
