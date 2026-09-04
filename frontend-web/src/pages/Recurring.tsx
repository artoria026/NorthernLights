import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  Lock,
  Pause,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  TrendingUp,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CategorySelect } from '@/components/nl/CategorySelect'
import { DialogFooter, DialogPrimaryButton } from '@/components/nl/DialogActions'
import { HelpSection, HelpTip } from '@/components/nl/Help'
import { EmptyState, HEADER_SECTIONS, SegmentedControl, SoftBadge, StatCard, ViewHeader } from '@/components/nl/primitives'
import { Donut } from '@/lib/charts'
import { FREQUENCY_LABELS, ITEM_TYPE_LABELS, monthlyEquivalent, STATUS_LABELS, URGENCY_LABELS } from '@/lib/recurring'
import { formatMoney, formatShortDate, selectClass } from '@/lib/utils'
import { useAccounts, useTdcCycle } from '@/hooks/useAccounts'
import { useCategories } from '@/hooks/useCategories'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import {
  type CreateRecurringItemInput,
  type UpdateRecurringItemInput,
  useCancelRecurringItem,
  useConfirmTransaction,
  useCreateRecurringItem,
  usePauseRecurringItem,
  usePendingRecurring,
  useRecurringItems,
  useRejectTransaction,
  useResumeRecurringItem,
  useUpcomingRecurring,
  useUpdateRecurringItem,
} from '@/hooks/useRecurring'
import { useTransactions } from '@/hooks/useTransactions'
import { apiErrorMessage } from '@/services/api'
import type { Account, AlertUrgency, RecurringFrequency, RecurringItem, RecurringItemType, Transaction } from '@/types'

// 'subscription' lives on its own dedicated page (/subscriptions) -- this
// general form only covers services/utilities/recurring income.
const ITEM_TYPES: RecurringItemType[] = ['service', 'utility', 'income']
const FREQUENCIES: RecurringFrequency[] = ['weekly', 'biweekly', 'monthly', 'bimonthly', 'annual']
const URGENCIES: AlertUrgency[] = ['normal', 'high', 'critical']

const DONUT_COLORS = [
  'var(--nl-accent)',
  'var(--nl-blue)',
  'var(--nl-warning)',
  'var(--nl-violet)',
  'var(--nl-danger)',
  'var(--nl-pink)',
]

const ITEM_TYPE_ICONS: Record<RecurringItemType, LucideIcon> = {
  service: Wrench,
  utility: Zap,
  income: TrendingUp,
  subscription: CreditCard,
}

/** Only high/critical carry an icon inside the badge -- normal is the
 * common case and an icon there would be visual noise with no new
 * information. */
const URGENCY_ICONS: Partial<Record<AlertUrgency, LucideIcon>> = {
  high: AlertCircle,
  critical: AlertTriangle,
}

const URGENCY_SEVERITY: Record<AlertUrgency, 'accent' | 'warning' | 'danger'> = {
  normal: 'accent',
  high: 'warning',
  critical: 'danger',
}

const STATUS_SEVERITY: Record<RecurringItem['status'], 'accent' | 'warning' | 'danger'> = {
  active: 'accent',
  paused: 'warning',
  cancelled: 'danger',
}

type StatusFilter = 'active' | 'paused' | 'cancelled' | 'all'

function NewRecurringItemForm({ onDone }: { onDone: () => void }) {
  const { data: accounts } = useAccounts()
  const createItem = useCreateRecurringItem()
  const [form, setForm] = useState<CreateRecurringItemInput>({
    name: '',
    item_type: 'service',
    amount: '',
    frequency: 'monthly',
    account_id: '',
    category_id: '',
    next_date: new Date().toISOString().slice(0, 10),
    auto_generate: true,
  })

  const entryType = form.item_type === 'income' ? 'income' : 'expense'
  const { data: categories } = useCategories(entryType)
  const payingAccounts = accounts?.filter((a) => a.type === 'asset' || a.type === 'liability')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form.category_id || !form.account_id) return
    try {
      await createItem.mutateAsync(form)
      onDone()
    } catch {
      // error shown below
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Nombre</label>
        <input
          required
          autoFocus
          placeholder="Ej: Seguro del auto, Dentista"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Tipo</label>
        <Select
          value={form.item_type}
          onValueChange={(v) =>
            setForm({ ...form, item_type: (v as RecurringItemType) ?? 'service', category_id: '' })
          }
        >
          <SelectTrigger className={selectClass}>
            <SelectValue>{ITEM_TYPE_LABELS[form.item_type]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ITEM_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {ITEM_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {form.item_type === 'utility' && (
          <p className="text-xs text-muted-foreground">
            Los servicios esenciales alertan a diario desde el primer día sin confirmar.
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Monto</label>
        <input
          type="number"
          step="0.01"
          required
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Frecuencia</label>
        <Select
          value={form.frequency}
          onValueChange={(v) => setForm({ ...form, frequency: (v as RecurringFrequency) ?? 'monthly' })}
        >
          <SelectTrigger className={selectClass}>
            <SelectValue>{FREQUENCY_LABELS[form.frequency]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {FREQUENCIES.map((f) => (
              <SelectItem key={f} value={f}>
                {FREQUENCY_LABELS[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Categoría</label>
        <CategorySelect
          categories={categories}
          value={form.category_id}
          onValueChange={(v) => setForm({ ...form, category_id: v })}
          placeholder="Selecciona categoría"
          triggerClassName={selectClass}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">
          Cuenta {form.item_type === 'income' ? 'que recibe' : 'que paga'} (banco/TDC)
        </label>
        <Select value={form.account_id || null} onValueChange={(v) => setForm({ ...form, account_id: v ?? '' })}>
          <SelectTrigger className={selectClass}>
            <SelectValue placeholder="Selecciona cuenta">
              {(v: string | null) => payingAccounts?.find((a) => a.id === v)?.name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {payingAccounts?.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Próximo cobro</label>
        <input
          type="date"
          required
          value={form.next_date}
          onChange={(e) => setForm({ ...form, next_date: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      {createItem.isError && (
        <p className="text-sm text-destructive">{apiErrorMessage(createItem.error)}</p>
      )}
      <DialogFooter>
        <DialogPrimaryButton icon={Plus} pending={createItem.isPending}>
          Crear
        </DialogPrimaryButton>
      </DialogFooter>
    </form>
  )
}

/** item_type can't be edited (see UpdateRecurringItemInput) -- that's why,
 * unlike NewRecurringItemForm, the category is filtered by the entry_type
 * the item ALREADY had (fixed), not by a type selector. */
function EditRecurringItemForm({ item, onDone }: { item: RecurringItem; onDone: () => void }) {
  const { data: accounts } = useAccounts()
  const entryType = item.item_type === 'income' ? 'income' : 'expense'
  const { data: categories } = useCategories(entryType)
  const payingAccounts = accounts?.filter((a) => a.type === 'asset' || a.type === 'liability')
  const updateItem = useUpdateRecurringItem()

  const [form, setForm] = useState<UpdateRecurringItemInput>({
    name: item.name,
    amount: item.amount,
    frequency: item.frequency,
    account_id: item.account_id,
    category_id: item.category_id,
    alert_urgency: item.alert_urgency,
    next_date: item.next_date,
  })

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      await updateItem.mutateAsync({ id: item.id, input: form })
      onDone()
    } catch {
      // error shown below
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Nombre</label>
        <input
          required
          autoFocus
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Monto</label>
        <input
          type="number"
          step="0.01"
          required
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Frecuencia</label>
        <Select
          value={form.frequency}
          onValueChange={(v) => setForm({ ...form, frequency: (v as RecurringFrequency) ?? 'monthly' })}
        >
          <SelectTrigger className={selectClass}>
            <SelectValue>{(v: RecurringFrequency) => FREQUENCY_LABELS[v]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {FREQUENCIES.map((f) => (
              <SelectItem key={f} value={f}>
                {FREQUENCY_LABELS[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Categoría</label>
        <CategorySelect
          categories={categories}
          value={form.category_id}
          onValueChange={(v) => setForm({ ...form, category_id: v })}
          placeholder="Selecciona categoría"
          triggerClassName={selectClass}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">
          Cuenta {item.item_type === 'income' ? 'que recibe' : 'que paga'} (banco/TDC)
        </label>
        <Select value={form.account_id || null} onValueChange={(v) => setForm({ ...form, account_id: v ?? '' })}>
          <SelectTrigger className={selectClass}>
            <SelectValue placeholder="Selecciona cuenta">
              {(v: string | null) => payingAccounts?.find((a) => a.id === v)?.name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {payingAccounts?.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Urgencia de alerta</label>
        <Select
          value={form.alert_urgency}
          onValueChange={(v) => setForm({ ...form, alert_urgency: (v as AlertUrgency) ?? 'normal' })}
        >
          <SelectTrigger className={selectClass}>
            <SelectValue>{(v: AlertUrgency) => URGENCY_LABELS[v]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {URGENCIES.map((u) => (
              <SelectItem key={u} value={u}>
                {URGENCY_LABELS[u]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Próximo cobro</label>
        <input
          type="date"
          required
          value={form.next_date}
          onChange={(e) => setForm({ ...form, next_date: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      {updateItem.isError && <p className="text-sm text-destructive">{apiErrorMessage(updateItem.error)}</p>}
      <DialogFooter>
        <DialogPrimaryButton icon={Check} pending={updateItem.isPending}>
          Guardar cambios
        </DialogPrimaryButton>
      </DialogFooter>
    </form>
  )
}

function PendingRow({ entry }: { entry: Transaction }) {
  const confirm = useConfirmTransaction()
  const reject = useRejectTransaction()
  const busy = confirm.isPending || reject.isPending

  const actionButtons = (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => reject.mutate(entry.id)}
        title="Rechazar"
        className="w-7 h-7 rounded-full flex items-center justify-center text-destructive hover:bg-destructive/10 disabled:opacity-40"
      >
        <X size={13} />
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => confirm.mutate(entry.id)}
        className="flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium disabled:opacity-40"
        style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
      >
        <Check size={12} />
        Confirmar
      </button>
    </>
  )

  return (
    <>
      <div className="hidden lg:grid grid-cols-[2fr_1fr_1fr_170px] gap-2 items-center py-2.5 border-t border-border first:border-0 text-[13px]">
        <span className="flex items-center gap-2 min-w-0">
          <Clock size={14} className="text-[color:var(--nl-warning-ink)] flex-shrink-0" />
          <span className="font-medium truncate">{entry.description}</span>
        </span>
        <span className="text-muted-foreground">{entry.date}</span>
        <span className="text-right">{formatMoney(entry.amount ?? '0')}</span>
        <span className="flex justify-end gap-1.5">{actionButtons}</span>
      </div>
      <div className="lg:hidden flex flex-col gap-2 py-3 border-t border-border first:border-0 text-[13px]">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 min-w-0">
            <Clock size={14} className="text-[color:var(--nl-warning-ink)] flex-shrink-0" />
            <span className="font-medium truncate">{entry.description}</span>
          </span>
          <span className="flex-shrink-0">{formatMoney(entry.amount ?? '0')}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-[12px]">{entry.date}</span>
          <span className="flex gap-1.5">{actionButtons}</span>
        </div>
      </div>
    </>
  )
}

function RecurringItemRow({ item }: { item: RecurringItem }) {
  const pause = usePauseRecurringItem()
  const cancel = useCancelRecurringItem()
  const resume = useResumeRecurringItem()
  const busy = pause.isPending || cancel.isPending || resume.isPending
  const [editOpen, setEditOpen] = useState(false)
  const isDesktop = useIsDesktop()
  const TypeIcon = ITEM_TYPE_ICONS[item.item_type]
  const UrgencyIcon = URGENCY_ICONS[item.alert_urgency]

  // A single Dialog with local state -- if this were duplicated across a
  // "desktop" tree and a "mobile" one hidden via CSS, it would mount twice
  // and opening it from either trigger would show two modals. That's why
  // it's built just once here, and isDesktop (based on window.matchMedia,
  // not CSS) decides which of the two layouts below gets mounted -- never
  // both.
  const actions = (
    <>
      <SoftBadge severity={STATUS_SEVERITY[item.status]}>{STATUS_LABELS[item.status]}</SoftBadge>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogTrigger
          render={
            <button
              type="button"
              disabled={busy}
              title="Editar"
              className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-info/10 hover:text-info disabled:opacity-40"
            >
              <Pencil size={13} />
            </button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar — {item.name}</DialogTitle>
          </DialogHeader>
          <EditRecurringItemForm item={item} onDone={() => setEditOpen(false)} />
        </DialogContent>
      </Dialog>
      {item.status === 'active' ? (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => pause.mutate(item.id)}
            title="Pausar"
            className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-warning/10 hover:text-warning disabled:opacity-40"
          >
            <Pause size={13} />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => cancel.mutate(item.id)}
            title="Cancelar"
            className="w-7 h-7 rounded-full flex items-center justify-center text-destructive hover:bg-destructive/10 disabled:opacity-40"
          >
            <X size={13} />
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => resume.mutate(item.id)}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium disabled:opacity-40"
          style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
        >
          <RotateCcw size={12} />
          Reactivar
        </button>
      )}
    </>
  )

  if (isDesktop) {
    return (
      <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr_1fr_1fr_240px] gap-2 items-center py-2.5 border-t border-border first:border-0 text-[13px]">
        <span className="flex items-center gap-2 min-w-0">
          <TypeIcon size={14} className="text-muted-foreground flex-shrink-0" />
          <span className="font-medium truncate">{item.name}</span>
        </span>
        <span>
          <SoftBadge severity="blue">{ITEM_TYPE_LABELS[item.item_type]}</SoftBadge>
        </span>
        <span
          className="text-right"
          style={{ color: item.item_type === 'income' ? 'var(--nl-accent-ink)' : undefined }}
        >
          {formatMoney(item.amount)}
        </span>
        <span className="text-muted-foreground">{FREQUENCY_LABELS[item.frequency]}</span>
        <span className="text-muted-foreground">{item.next_date}</span>
        <span>
          <SoftBadge severity={URGENCY_SEVERITY[item.alert_urgency]}>
            <span className="inline-flex items-center gap-1">
              {UrgencyIcon && <UrgencyIcon size={11} />}
              {URGENCY_LABELS[item.alert_urgency]}
            </span>
          </SoftBadge>
        </span>
        <span className="flex justify-end items-center gap-1.5" data-tour="recurring:item-actions">
          {actions}
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 py-3 border-t border-border first:border-0 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 min-w-0">
          <TypeIcon size={14} className="text-muted-foreground flex-shrink-0" />
          <span className="font-medium truncate">{item.name}</span>
        </span>
        <span
          className="flex-shrink-0"
          style={{ color: item.item_type === 'income' ? 'var(--nl-accent-ink)' : undefined }}
        >
          {formatMoney(item.amount)}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <SoftBadge severity="blue">{ITEM_TYPE_LABELS[item.item_type]}</SoftBadge>
        <SoftBadge severity={URGENCY_SEVERITY[item.alert_urgency]}>
          <span className="inline-flex items-center gap-1">
            {UrgencyIcon && <UrgencyIcon size={11} />}
            {URGENCY_LABELS[item.alert_urgency]}
          </span>
        </SoftBadge>
        <span className="text-muted-foreground text-[12px]">
          {FREQUENCY_LABELS[item.frequency]} · {item.next_date}
        </span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">{actions}</div>
    </div>
  )
}

/** Last date (YYYY-MM-DD) a credit card with this billing day cut off, on
 * or before today -- JS mirror of account_service._last_occurrence (same
 * end-of-month clamp). Comparing dates as ISO strings instead of Date
 * avoids the timezone offset from `new Date("YYYY-MM-DD")` (parsed as
 * midnight UTC, not local). */
function lastCycleBoundary(billingCycleDay: number, today: Date): string {
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

/** A credit card's row inside CreditCardCommitments -- each one queries its
 * own cycle and its own transactions (both already filtered by account_id
 * on the backend -- never depends on which position in `lines` the real
 * account falls on, for expenses that position varies, see
 * transaction_service._resolve_lines). Reports its total to
 * CreditCardCommitments via onTotal for the grand total.
 *
 * The "cycle spend" does NOT use cycle.current_cycle_balance (that's net of
 * payments made during the cycle, meant for the Accounts detail view) --
 * here only the gross expense gets summed, not counting interest-free
 * installment purchases (MSI) (those are already represented by their
 * monthly amount in `installmentTotal`, adding them here too would double
 * count them) nor payments (a card payment would lower this number, giving
 * the impression you owe less by the next cutoff). */
function CreditCardCommitmentRow({
  account,
  onTotal,
}: {
  account: Account
  onTotal: (accountId: string, total: number) => void
}) {
  const { data: cycle } = useTdcCycle(account.id, true)
  const { data: ledger } = useTransactions({ account_id: account.id, per_page: 50 })

  const activeInstallments = (ledger?.data ?? []).filter(
    (tx) => tx.installment && tx.installment.paid_installments < tx.installment.total_installments,
  )
  const installmentTotal = activeInstallments.reduce(
    (sum, tx) => sum + Number(tx.installment?.monthly_amount ?? 0),
    0,
  )
  const boundary = cycle?.billing_cycle_day ? lastCycleBoundary(cycle.billing_cycle_day, new Date()) : null
  const cycleSpend = boundary
    ? (ledger?.data ?? [])
        .filter((tx) => tx.entry_type === 'expense' && !tx.installment && tx.date > boundary)
        .reduce((sum, tx) => sum + Number(tx.amount ?? 0), 0)
    : 0
  const total = installmentTotal + cycleSpend

  useEffect(() => {
    onTotal(account.id, total)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, total])

  if (total <= 0) return null

  return (
    <div className="flex items-center justify-between gap-2 py-2 border-t border-border first:border-0 text-[13px]">
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: account.color }} />
        <span className="truncate">{account.name}</span>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0 text-[12px] text-muted-foreground">
        {installmentTotal > 0 && <span>MSI {formatMoney(String(installmentTotal))}</span>}
        {cycleSpend > 0 && <span>corte {formatMoney(String(cycleSpend))}</span>}
        <span className="text-[13px] font-medium text-foreground">{formatMoney(String(total))}</span>
      </div>
    </div>
  )
}

/** The user's credit card commitment ahead of the next cutoff -- the fixed
 * MSI monthly amount (has to be paid no matter what) + what's already been
 * spent in the open cycle (variable, keeps rising until the cutoff). Purely
 * informative: NOT added to the "Comprometido / mes" above (that's only
 * real Debts + Recurring items) -- adding it there would double count the
 * expense, which was already registered as its own transaction and already
 * counts toward the month's budget "spent". Explicit user decision: the
 * credit card stays out of the debt/commitment machinery unless it becomes
 * an overdue debt under negotiation. */
function CreditCardCommitments({ creditCards }: { creditCards: Account[] }) {
  const [totals, setTotals] = useState<Record<string, number>>({})
  const handleTotal = useCallback((accountId: string, total: number) => {
    setTotals((prev) => (prev[accountId] === total ? prev : { ...prev, [accountId]: total }))
  }, [])
  const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0)

  return (
    <div className="bg-card border border-border rounded-md p-4 mb-4" data-tour="recurring:card-commitments">
      <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-[15px] font-medium">
          <CreditCard size={15} />
          Lo que ya deben tus tarjetas el próximo corte
        </div>
        {grandTotal > 0 && (
          <span className="text-[15px] font-medium" style={{ color: 'var(--nl-warning-ink)' }}>
            {formatMoney(String(grandTotal))}
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground mb-1">
        Mensualidades de compras a meses sin intereses + lo que llevas gastado en el corte abierto de cada
        tarjeta. Informativo -- no está incluido en "Comprometido / mes" de arriba.
      </p>
      {creditCards.map((account) => (
        <CreditCardCommitmentRow key={account.id} account={account} onTotal={handleTotal} />
      ))}
    </div>
  )
}

function RecurringHelp() {
  return (
    <>
      <HelpSection heading="Qué es esta pantalla">
        <p>
          Gastos e ingresos que se repiten en un ciclo fijo — servicios, utilities (luz, agua, internet) e
          ingresos recurrentes como una nómina. Las suscripciones (Netflix, Spotify, etc.) tienen su
          propia página dedicada.
        </p>
      </HelpSection>
      <HelpSection heading="Sin confirmar">
        <p>
          Cuando se acerca la fecha de un recurrente, el sistema prepara automáticamente el movimiento
          como borrador — aparece aquí arriba para que lo confirmes (se registra tal cual) o lo rechaces
          (no pasó, se descarta) antes de que cuente como una transacción real.
        </p>
      </HelpSection>
      <HelpSection heading="Editar / Pausar / Cancelar / Reanudar">
        <p>
          Editar cambia monto, frecuencia, cuenta, categoría, urgencia o próximo cobro sin perder el
          historial del item — úsalo cuando te suban la renta o cambie el monto de un servicio. Pausar
          detiene temporalmente la generación automática sin perder la configuración. Cancelar lo da de
          baja definitivo. Todos se pueden reanudar después.
        </p>
      </HelpSection>
      <HelpSection heading="Próximos pagos y desglose por categoría">
        <p>
          "Próximos pagos" son los que caen en los siguientes 7 días, para planear tu quincena. El
          desglose por categoría reparte el "Comprometido / mes" (mismo total, mismo alcance: sin
          suscripciones ni ingresos) para ver en qué se va ese dinero.
        </p>
      </HelpSection>
      <HelpSection heading="Lo que ya deben tus tarjetas">
        <p>
          Solo aparece si tienes al menos una tarjeta de crédito. Suma las mensualidades de tus compras a
          meses sin intereses activas (fijo, se paga sí o sí) más lo que ya llevas gastado en el corte
          abierto de cada tarjeta (variable, sigue subiendo hasta que corte). Es solo informativo -- no se
          suma al "Comprometido / mes" de arriba, porque ese gasto ya se contó en el presupuesto del mes en
          que lo hiciste; sumarlo aquí también lo contaría dos veces.
        </p>
      </HelpSection>
      <HelpTip>
        La urgencia de alerta (normal/alta/crítica) controla qué tan insistente es el aviso antes de la
        fecha de cobro — no afecta el monto ni la fecha en sí. Los "Servicios esenciales" son la
        excepción: alertan a diario desde el primer día sin confirmar, sin importar la urgencia que les
        pongas.
      </HelpTip>
    </>
  )
}

export function Recurring() {
  const { data: pending, isLoading: loadingPending } = usePendingRecurring()
  const { data: items, isLoading: loadingItems } = useRecurringItems()
  const { data: upcoming } = useUpcomingRecurring(7)
  const { data: expenseCategories } = useCategories('expense')
  const { data: accounts } = useAccounts()
  const creditCards = accounts?.filter((a) => a.type === 'liability' && a.subtype === 'credit_card') ?? []
  const [status, setStatus] = useState<StatusFilter>('active')
  const [open, setOpen] = useState(false)

  const pendingEntries = (pending ?? []) as Transaction[]
  // The dedicated Subscriptions page covers item_type='subscription' --
  // here only services/utilities/income.
  const all = (items ?? []).filter((i) => i.item_type !== 'subscription')
  const active = all.filter((i) => i.status === 'active')
  const visible = status === 'all' ? all : all.filter((i) => i.status === status)
  const expenseItems = active.filter((i) => i.item_type !== 'income')
  const committedMonthly = expenseItems.reduce(
    (sum, i) => sum + monthlyEquivalent(i.amount, i.frequency),
    0,
  )
  const incomeMonthly = active
    .filter((i) => i.item_type === 'income')
    .reduce((sum, i) => sum + monthlyEquivalent(i.amount, i.frequency), 0)

  const categoryTotals = new Map<string, number>()
  for (const item of expenseItems) {
    categoryTotals.set(
      item.category_id,
      (categoryTotals.get(item.category_id) ?? 0) + monthlyEquivalent(item.amount, item.frequency),
    )
  }
  const categoryBreakdown = [...categoryTotals.entries()]
    .map(([categoryId, value], i) => {
      const category = expenseCategories?.find((c) => c.id === categoryId)
      return {
        value,
        color: category?.color ?? DONUT_COLORS[i % DONUT_COLORS.length],
        name: category?.name ?? 'Otro',
      }
    })
    .sort((a, b) => b.value - a.value)

  // Same as in the main table, subscriptions left out -- they have their
  // own screen and their own due-date reminder.
  const upcomingItems = (upcoming ?? []).filter((i) => i.item_type !== 'subscription')

  return (
    <div>
      <ViewHeader
        icon={<RefreshCw />}
        title="Gastos Recurrentes"
        help={<RecurringHelp />}
        section={HEADER_SECTIONS.compromisos}
        tourKey="recurring"
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger
              render={
                <button
                  type="button"
                  data-tour="recurring:new-button"
                  className="flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[13px] font-medium"
                  style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
                >
                  <Plus size={14} />
                  Agregar recurrente
                </button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nuevo gasto recurrente</DialogTitle>
              </DialogHeader>
              <NewRecurringItemForm onDone={() => setOpen(false)} />
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 mb-4 lg:flex lg:gap-3 lg:flex-wrap">
        <StatCard
          compact
          icon={<Lock />}
          label="Comprometido / mes"
          value={Number(committedMonthly).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}
          note="Servicios y utilities activos (sin suscripciones ni ingresos)"
        />
        <StatCard
          compact
          icon={<TrendingUp />}
          label="Ingreso recurrente / mes"
          value={Number(incomeMonthly).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}
          valueClassName="text-[color:var(--nl-accent-ink)]"
          note="Nómina y otros ingresos activos"
        />
        <StatCard
          compact
          icon={<Clock />}
          label="Sin confirmar"
          value={String(pendingEntries.length)}
          valueClassName={pendingEntries.length > 0 ? 'text-[color:var(--nl-warning-ink)]' : undefined}
          borderColor={pendingEntries.length > 0 ? 'var(--nl-warning)' : undefined}
          note={pendingEntries.length > 0 ? 'Confírmalos abajo' : 'Todo al día'}
          dataTour="recurring:pending"
        />
        <StatCard compact icon={<CheckCircle2 />} label="Items activos" value={String(active.length)} />
      </div>

      {creditCards.length > 0 && <CreditCardCommitments creditCards={creditCards} />}

      {!loadingPending && pendingEntries.length > 0 && (
        <div className="bg-card border border-border rounded-md p-4 mb-4">
          <div className="text-[15px] font-medium mb-1">Pagos pendientes de confirmar</div>
          <div className="hidden lg:grid grid-cols-[2fr_1fr_1fr_170px] gap-2 text-[11px] uppercase tracking-wide text-muted-foreground mt-3">
            <span>Concepto</span>
            <span>Fecha</span>
            <span className="text-right">Monto</span>
            <span className="text-right">Acción</span>
          </div>
          {pendingEntries.map((entry) => (
            <PendingRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start mb-4">
        <div className="bg-card border border-border rounded-md p-4" data-tour="recurring:upcoming">
          <div className="text-[15px] font-medium mb-2">Próximos pagos (7 días)</div>
          {upcomingItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada programado en los próximos 7 días.</p>
          ) : (
            upcomingItems.map((item) => {
              const TypeIcon = ITEM_TYPE_ICONS[item.item_type]
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-2 lg:gap-3 py-2.5 border-t border-border first:border-0"
                >
                  <TypeIcon size={14} className="text-muted-foreground flex-shrink-0" />
                  <span className="text-[13px] font-medium flex-1 min-w-0 truncate">{item.name}</span>
                  <div className="hidden lg:block flex-shrink-0">
                    <SoftBadge severity="blue">{ITEM_TYPE_LABELS[item.item_type]}</SoftBadge>
                  </div>
                  <span className="text-[13px] text-muted-foreground w-16 lg:w-24 text-right flex-shrink-0">
                    {formatShortDate(item.next_date)}
                  </span>
                  <span
                    className="text-[13px] w-20 lg:w-28 text-right flex-shrink-0"
                    style={{ color: item.item_type === 'income' ? 'var(--nl-accent-ink)' : undefined }}
                  >
                    {formatMoney(item.amount)}
                  </span>
                </div>
              )
            })
          )}
        </div>

        <div className="bg-card border border-border rounded-md p-4" data-tour="recurring:breakdown">
          <div className="text-[15px] font-medium mb-2">Desglose por categoría</div>
          {categoryBreakdown.length > 0 ? (
            <div className="flex flex-col items-center gap-3">
              <Donut
                slices={categoryBreakdown}
                centerLabel={Number(committedMonthly).toLocaleString('es-MX', {
                  style: 'currency',
                  currency: 'MXN',
                  maximumFractionDigits: 0,
                })}
                centerSub="por mes"
              />
              <div className="flex flex-col gap-1.5 w-full">
                {categoryBreakdown.map((s) => (
                  <div key={s.name} className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: s.color }} />
                    <span className="text-[11px] text-muted-foreground truncate flex-1">{s.name}</span>
                    <span className="text-[11px]">{Math.round((s.value / (committedMonthly || 1)) * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Sin servicios/utilities activos todavía.</p>
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-md p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div className="text-[15px] font-medium">Servicios e ingresos recurrentes</div>
          <div data-tour="recurring:status-filter">
            <SegmentedControl
              value={status}
              onChange={setStatus}
              options={[
                { value: 'active', label: 'Activos' },
                { value: 'paused', label: 'Pausados' },
                { value: 'cancelled', label: 'Cancelados' },
                { value: 'all', label: 'Todos' },
              ]}
            />
          </div>
        </div>

        {loadingItems ? (
          <p className="text-sm text-muted-foreground">Cargando...</p>
        ) : visible.length === 0 ? (
          <EmptyState>No hay recurrentes con este estado.</EmptyState>
        ) : (
          <>
            <div className="hidden lg:grid grid-cols-[1.6fr_1fr_1fr_1fr_1fr_1fr_240px] gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              <span>Nombre</span>
              <span>Tipo</span>
              <span className="text-right">Monto</span>
              <span>Frecuencia</span>
              <span>Próximo cobro</span>
              <span>Urgencia</span>
              <span className="text-right">Estado / Acción</span>
            </div>
            {visible.map((item) => (
              <RecurringItemRow key={item.id} item={item} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
