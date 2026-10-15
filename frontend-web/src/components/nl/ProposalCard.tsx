import { Ban, Check, CheckCircle2, Clock, Loader2, Receipt, TriangleAlert, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatMoney } from '@/lib/utils'
import type { ProposalField, ProposalItem, ProposalStatus } from '@/types'

const MONEY_KEYS = new Set([
  'amount',
  'total_amount',
  'current_balance',
  'initial_balance',
  'payment_amount',
  'credit_limit',
])

function fieldMap(item: ProposalItem): Record<string, string> {
  return Object.fromEntries(item.fields.map((f) => [f.key, f.value]))
}

/** A value from the advisor, as the user should read it: money as money, a rate as a
 * percentage, a known option (expense, monthly, savings...) in the UI language. */
function useFormatValue() {
  const { t } = useTranslation('pages')
  return (field: ProposalField): string => {
    if (MONEY_KEYS.has(field.key)) return formatMoney(field.value)
    if (field.key === 'interest_rate') {
      const rate = Number(field.value)
      return Number.isFinite(rate) ? `${+(rate <= 1 ? rate * 100 : rate).toFixed(2)}%` : field.value
    }
    if (field.key === 'entry_type') return t(`advisor.proposal.entryType.${field.value}`, { defaultValue: field.value })
    return t(`advisor.proposal.values.${field.value}`, { defaultValue: field.value })
  }
}

const STATUS_STYLE: Record<ProposalStatus, { bg: string; ink: string }> = {
  pending: { bg: 'var(--nl-violet-soft-bg)', ink: 'var(--nl-violet-ink)' },
  confirmed: { bg: 'var(--nl-accent-soft-bg)', ink: 'var(--nl-accent-ink)' },
  failed: { bg: 'var(--nl-danger-soft-bg)', ink: 'var(--nl-danger-ink)' },
  cancelled: { bg: 'var(--nl-bg-input)', ink: 'var(--nl-text-secondary)' },
  expired: { bg: 'var(--nl-bg-input)', ink: 'var(--nl-text-secondary)' },
  superseded: { bg: 'var(--nl-bg-input)', ink: 'var(--nl-text-secondary)' },
}

const STATUS_ICON = {
  pending: Receipt,
  confirmed: CheckCircle2,
  failed: TriangleAlert,
  cancelled: Ban,
  expired: Clock,
  superseded: Ban,
} as const

function TransactionsTable({ items }: { items: ProposalItem[] }) {
  const { t } = useTranslation('pages')
  const format = useFormatValue()
  const rows = items.map(fieldMap)
  const totalOf = (type: string) =>
    rows.filter((r) => r.entry_type === type).reduce((sum, r) => sum + Number(r.amount ?? 0), 0)
  const expenses = totalOf('expense')
  const income = totalOf('income')

  return (
    <div className="flex flex-col gap-2">
      <div className="max-h-72 overflow-auto rounded-md border border-border">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="text-left text-muted-foreground" style={{ background: 'var(--nl-bg-input)' }}>
              <th className="px-2 py-1.5 font-medium whitespace-nowrap">{t('advisor.proposal.fields.date')}</th>
              <th className="px-2 py-1.5 font-medium">{t('advisor.proposal.fields.description')}</th>
              <th className="px-2 py-1.5 font-medium">{t('advisor.proposal.fields.category')}</th>
              <th className="px-2 py-1.5 font-medium text-right">{t('advisor.proposal.fields.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-border align-top">
                <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">{row.date}</td>
                <td className="px-2 py-1.5">
                  <div>{row.description}</div>
                  <div className="text-[11px] text-muted-foreground">{row.account}</div>
                </td>
                <td className="px-2 py-1.5">{row.category}</td>
                <td
                  className="px-2 py-1.5 text-right whitespace-nowrap"
                  style={row.entry_type === 'income' ? { color: 'var(--nl-accent-ink)' } : undefined}
                >
                  {format({ key: 'amount', value: row.amount ?? '0' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
        <span>{t('advisor.proposal.movements', { count: rows.length })}</span>
        <span className="flex gap-3">
          {expenses > 0 && (
            <span>
              {t('advisor.proposal.entryType.expense')}: <strong>{formatMoney(expenses)}</strong>
            </span>
          )}
          {income > 0 && (
            <span>
              {t('advisor.proposal.entryType.income')}: <strong>{formatMoney(income)}</strong>
            </span>
          )}
        </span>
      </div>
    </div>
  )
}

function GenericItems({ items }: { items: ProposalItem[] }) {
  const { t } = useTranslation('pages')
  const format = useFormatValue()
  return (
    <div className="flex flex-col gap-2 max-h-72 overflow-auto">
      {items.map((item, i) => (
        <div key={i} className="rounded-md p-2.5 text-[12.5px]" style={{ background: 'var(--nl-bg-input)' }}>
          <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            {t(`advisor.proposal.actions.${item.action}`, { defaultValue: item.action })}
          </div>
          <div className="flex flex-col gap-1">
            {item.fields.map((field, fi) => (
              <div key={fi} className="flex justify-between gap-3">
                <span className="text-muted-foreground">
                  {t(`advisor.proposal.fields.${field.key}`, { defaultValue: field.key })}
                </span>
                <span className="font-medium text-right">{format(field)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** What the advisor proposes to register, with its Confirm / Cancel buttons.
 *
 * Everything shown comes from what the server stored, and confirming runs exactly
 * that: the advisor does not get to change it afterwards. Once resolved, the card
 * keeps showing the outcome (registered, cancelled, failed, expired). */
export function ProposalCard({
  summary,
  items,
  status,
  error,
  busy,
  onConfirm,
  onCancel,
}: {
  summary: string
  items: ProposalItem[]
  status: ProposalStatus
  error?: string | null
  /** Which button was pressed while the server works on it. */
  busy?: 'confirm' | 'cancel' | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation('pages')
  const style = STATUS_STYLE[status]
  const Icon = STATUS_ICON[status]
  const allTransactions = items.length > 0 && items.every((i) => i.action === 'create_transaction')

  return (
    <div className="w-full max-w-[620px] rounded-[10px] border border-border overflow-hidden bg-card">
      <div
        className="flex items-center gap-2 px-3.5 py-2.5 text-[12px] font-semibold"
        style={{ background: style.bg, color: style.ink }}
      >
        <Icon size={13} className="flex-shrink-0" />
        {t(`advisor.proposal.status.${status}`)}
      </div>
      <div className="px-3.5 py-3 flex flex-col gap-2.5">
        <p className="text-[12.5px]">{summary}</p>
        {allTransactions ? <TransactionsTable items={items} /> : <GenericItems items={items} />}
        {status === 'failed' && error && (
          <p className="text-[12px]" style={{ color: 'var(--nl-danger-ink)' }}>
            {error}
          </p>
        )}
        {status === 'failed' && <p className="text-[12px] text-muted-foreground">{t('advisor.proposal.failedHint')}</p>}
        {status === 'expired' && <p className="text-[12px] text-muted-foreground">{t('advisor.proposal.expiredHint')}</p>}
      </div>
      {status === 'pending' && (
        <div className="flex gap-2 px-3.5 py-3 border-t border-border">
          <button
            type="button"
            onClick={onConfirm}
            disabled={!!busy}
            className="flex-1 rounded-md py-2 text-[12.5px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
            style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
          >
            {busy === 'confirm' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {t('advisor.proposal.confirmButton')}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={!!busy}
            className="flex-1 rounded-md py-2 text-[12.5px] border border-border text-muted-foreground hover:text-foreground disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {busy === 'cancel' ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
            {t('advisor.proposal.cancelButton')}
          </button>
        </div>
      )}
    </div>
  )
}
