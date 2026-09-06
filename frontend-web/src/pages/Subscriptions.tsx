import {
  CalendarClock,
  Check,
  CheckCircle2,
  Lock,
  Pause,
  PauseCircle,
  Pencil,
  Plus,
  Repeat,
  RotateCcw,
  X,
  XCircle,
} from 'lucide-react'
import { type FormEvent, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CategorySelect } from '@/components/nl/CategorySelect'
import { DialogFooter, DialogPrimaryButton } from '@/components/nl/DialogActions'
import { HelpSection, HelpTip } from '@/components/nl/Help'
import { EmptyState, HEADER_SECTIONS, SegmentedControl, SoftBadge, StatCard, ViewHeader } from '@/components/nl/primitives'
import { FREQUENCY_LABELS, monthlyEquivalent, STATUS_LABELS } from '@/lib/recurring'
import { formatMoney, formatShortDate, selectClass } from '@/lib/utils'
import { useAccounts } from '@/hooks/useAccounts'
import { useCategories } from '@/hooks/useCategories'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import {
  type CreateRecurringItemInput,
  type UpdateRecurringItemInput,
  useCancelRecurringItem,
  useCreateRecurringItem,
  usePauseRecurringItem,
  useRecurringItems,
  useResumeRecurringItem,
  useUpcomingRecurring,
  useUpdateRecurringItem,
} from '@/hooks/useRecurring'
import { apiErrorMessage } from '@/services/api'
import type { RecurringFrequency, RecurringItem } from '@/types'

const FREQUENCIES: RecurringFrequency[] = ['weekly', 'biweekly', 'monthly', 'bimonthly', 'annual']
type StatusFilter = 'active' | 'paused' | 'cancelled' | 'all'

/** How long it's been active, in months -- created_at already existed but
 * wasn't shown; useful for noticing a subscription that's gone a long time
 * without being reviewed. */
function monthsSince(dateStr: string): number {
  const start = new Date(dateStr)
  const now = new Date()
  return (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
}

function activeSinceLabel(dateStr: string, t: TFunction): string {
  const months = monthsSince(dateStr)
  if (months <= 0) return t('subscriptions.activeSinceThisMonth')
  return t('subscriptions.activeSince', { count: months })
}

function NewSubscriptionForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation('pages')
  const { data: accounts } = useAccounts()
  const { data: categories } = useCategories('expense')
  const createItem = useCreateRecurringItem()
  const [form, setForm] = useState<CreateRecurringItemInput>({
    name: '',
    item_type: 'subscription',
    amount: '',
    frequency: 'monthly',
    account_id: '',
    category_id: '',
    next_date: new Date().toISOString().slice(0, 10),
    auto_generate: true,
  })
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
        <label className="text-xs text-muted-foreground">{t('subscriptions.form.nameLabel')}</label>
        <input
          required
          autoFocus
          placeholder={t('subscriptions.form.namePlaceholder')}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t('subscriptions.form.amountLabel')}</label>
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
        <label className="text-xs text-muted-foreground">{t('subscriptions.form.frequencyLabel')}</label>
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
        {form.amount && (
          <p className="text-xs text-muted-foreground">
            {t('subscriptions.form.monthlyEquivalentNote', {
              amount: formatMoney(monthlyEquivalent(form.amount, form.frequency)),
            })}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t('subscriptions.form.categoryLabel')}</label>
        <CategorySelect
          categories={categories}
          value={form.category_id}
          onValueChange={(v) => setForm({ ...form, category_id: v })}
          placeholder={t('subscriptions.form.categoryPlaceholder')}
          triggerClassName={selectClass}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t('subscriptions.form.accountLabel')}</label>
        <Select value={form.account_id || null} onValueChange={(v) => setForm({ ...form, account_id: v ?? '' })}>
          <SelectTrigger className={selectClass}>
            <SelectValue placeholder={t('subscriptions.form.accountPlaceholder')}>
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
        <label className="text-xs text-muted-foreground">{t('subscriptions.form.nextDateLabel')}</label>
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
          {t('subscriptions.newItemForm.submitButton')}
        </DialogPrimaryButton>
      </DialogFooter>
    </form>
  )
}

function EditSubscriptionForm({ item, onDone }: { item: RecurringItem; onDone: () => void }) {
  const { t } = useTranslation('pages')
  const { data: accounts } = useAccounts()
  const { data: categories } = useCategories('expense')
  const payingAccounts = accounts?.filter((a) => a.type === 'asset' || a.type === 'liability')
  const updateItem = useUpdateRecurringItem()

  const [form, setForm] = useState<UpdateRecurringItemInput>({
    name: item.name,
    amount: item.amount,
    frequency: item.frequency,
    account_id: item.account_id,
    category_id: item.category_id,
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
        <label className="text-xs text-muted-foreground">{t('subscriptions.form.nameLabel')}</label>
        <input
          required
          autoFocus
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t('subscriptions.form.amountLabel')}</label>
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
        <label className="text-xs text-muted-foreground">{t('subscriptions.form.frequencyLabel')}</label>
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
        {form.amount && form.frequency && (
          <p className="text-xs text-muted-foreground">
            {t('subscriptions.form.monthlyEquivalentNote', {
              amount: formatMoney(monthlyEquivalent(form.amount, form.frequency)),
            })}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t('subscriptions.form.categoryLabel')}</label>
        <CategorySelect
          categories={categories}
          value={form.category_id}
          onValueChange={(v) => setForm({ ...form, category_id: v })}
          placeholder={t('subscriptions.form.categoryPlaceholder')}
          triggerClassName={selectClass}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t('subscriptions.form.accountLabel')}</label>
        <Select value={form.account_id || null} onValueChange={(v) => setForm({ ...form, account_id: v ?? '' })}>
          <SelectTrigger className={selectClass}>
            <SelectValue placeholder={t('subscriptions.form.accountPlaceholder')}>
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
        <label className="text-xs text-muted-foreground">{t('subscriptions.form.nextDateLabel')}</label>
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
          {t('subscriptions.editItemForm.submitButton')}
        </DialogPrimaryButton>
      </DialogFooter>
    </form>
  )
}

const STATUS_SEVERITY: Record<RecurringItem['status'], 'accent' | 'warning' | 'danger'> = {
  active: 'accent',
  paused: 'warning',
  cancelled: 'danger',
}

function SubscriptionRow({ item, categoryName, categoryColor }: { item: RecurringItem; categoryName: string; categoryColor: string }) {
  const { t } = useTranslation('pages')
  const pause = usePauseRecurringItem()
  const cancel = useCancelRecurringItem()
  const resume = useResumeRecurringItem()
  const busy = pause.isPending || cancel.isPending || resume.isPending
  const [editOpen, setEditOpen] = useState(false)
  const isDesktop = useIsDesktop()
  const oldEnough = item.status === 'active' && monthsSince(item.created_at) >= 12

  // A single Dialog with local state -- see the same comment in
  // RecurringItemRow (pages/Recurring.tsx). isDesktop decides which layout
  // below gets mounted, never both at once.
  const actions = (
    <>
      <SoftBadge severity={STATUS_SEVERITY[item.status]}>{STATUS_LABELS[item.status]}</SoftBadge>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogTrigger
          render={
            <button
              type="button"
              disabled={busy}
              title={t('subscriptions.itemActions.editTitle')}
              className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-info/10 hover:text-info disabled:opacity-40"
            >
              <Pencil size={13} />
            </button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('subscriptions.itemActions.editDialogTitle', { name: item.name })}</DialogTitle>
          </DialogHeader>
          <EditSubscriptionForm item={item} onDone={() => setEditOpen(false)} />
        </DialogContent>
      </Dialog>
      {item.status === 'active' ? (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => pause.mutate(item.id)}
            title={t('subscriptions.itemActions.pauseTitle')}
            className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-warning/10 hover:text-warning disabled:opacity-40"
          >
            <Pause size={13} />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => cancel.mutate(item.id)}
            title={t('subscriptions.itemActions.cancelTitle')}
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
          {t('subscriptions.itemActions.resumeButton')}
        </button>
      )}
    </>
  )

  const meta = (
    <div className="flex items-center gap-3 flex-wrap mt-1.5 pl-0.5 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: categoryColor }} />
        {categoryName}
      </span>
      {item.status === 'active' && (
        <span style={oldEnough ? { color: 'var(--nl-warning-ink)' } : undefined}>
          {activeSinceLabel(item.created_at, t)}
          {oldEnough ? t('subscriptions.stillUsingSuffix') : ''}
        </span>
      )}
    </div>
  )

  if (isDesktop) {
    return (
      <div className="py-2.5 border-t border-border first:border-0">
        <div className="grid grid-cols-[2fr_1.2fr_1fr_1fr_230px] gap-2 items-center text-[13px]">
          <span className="font-medium truncate">{item.name}</span>
          <span className="text-muted-foreground">
            {formatMoney(item.amount)} · {FREQUENCY_LABELS[item.frequency]}
          </span>
          <span className="text-right">
            {t('subscriptions.monthlyEquivalentSuffix', {
              amount: formatMoney(monthlyEquivalent(item.amount, item.frequency)),
            })}
          </span>
          <span className="text-right text-muted-foreground">{item.next_date}</span>
          <span className="flex justify-end items-center gap-1.5" data-tour="subscriptions:item-actions">
            {actions}
          </span>
        </div>
        <div data-tour="subscriptions:aging">{meta}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 py-3 border-t border-border first:border-0 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium truncate">{item.name}</span>
        <span className="flex-shrink-0">
          {t('subscriptions.monthlyEquivalentSuffix', {
            amount: formatMoney(monthlyEquivalent(item.amount, item.frequency)),
          })}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
        <span>
          {formatMoney(item.amount)} · {FREQUENCY_LABELS[item.frequency]}
        </span>
        <span>{item.next_date}</span>
      </div>
      {meta}
      <div className="flex items-center gap-1.5 flex-wrap mt-1">{actions}</div>
    </div>
  )
}

function SubscriptionsHelp() {
  const { t } = useTranslation('pages')
  return (
    <>
      <HelpSection heading={t('subscriptions.help.whatIsThisScreen.heading')}>
        <p>{t('subscriptions.help.whatIsThisScreen.body')}</p>
      </HelpSection>
      <HelpSection heading={t('subscriptions.help.monthlyCommitment.heading')}>
        <p>{t('subscriptions.help.monthlyCommitment.body')}</p>
      </HelpSection>
      <HelpSection heading={t('subscriptions.help.editPauseCancel.heading')}>
        <p>{t('subscriptions.help.editPauseCancel.body')}</p>
      </HelpSection>
      <HelpSection heading={t('subscriptions.help.activeSince.heading')}>
        <p>{t('subscriptions.help.activeSince.body')}</p>
      </HelpSection>
      <HelpSection heading={t('subscriptions.help.upcomingRenewals.heading')}>
        <p>{t('subscriptions.help.upcomingRenewals.body')}</p>
      </HelpSection>
      <HelpTip>{t('subscriptions.help.tip')}</HelpTip>
    </>
  )
}

const FALLBACK_CATEGORY_COLOR = 'var(--nl-text-muted)'

export function Subscriptions() {
  const { t } = useTranslation('pages')
  const { data: items, isLoading } = useRecurringItems({ item_type: 'subscription' })
  const { data: categories } = useCategories('expense')
  const { data: upcoming } = useUpcomingRecurring(7)
  const [status, setStatus] = useState<StatusFilter>('active')
  const [open, setOpen] = useState(false)

  const all = items ?? []
  const active = all.filter((i) => i.status === 'active')
  const paused = all.filter((i) => i.status === 'paused')
  const cancelled = all.filter((i) => i.status === 'cancelled')
  const visible = status === 'all' ? all : all.filter((i) => i.status === status)
  const committedMonthly = active.reduce((sum, i) => sum + monthlyEquivalent(i.amount, i.frequency), 0)
  const upcomingRenewals = (upcoming ?? []).filter((i) => i.item_type === 'subscription')

  return (
    <div>
      <ViewHeader
        icon={<Repeat />}
        title={t('subscriptions.title')}
        help={<SubscriptionsHelp />}
        section={HEADER_SECTIONS.compromisos}
        tourKey="subscriptions"
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger
              render={
                <button
                  type="button"
                  data-tour="subscriptions:new-button"
                  className="flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[13px] font-medium"
                  style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
                >
                  <Plus size={14} />
                  {t('subscriptions.header.addButton')}
                </button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('subscriptions.newItemDialogTitle')}</DialogTitle>
              </DialogHeader>
              <NewSubscriptionForm onDone={() => setOpen(false)} />
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 mb-4 lg:flex lg:gap-3 lg:flex-wrap">
        <StatCard
          compact
          icon={<Lock />}
          label={t('subscriptions.stats.committedMonthly')}
          value={formatMoney(committedMonthly)}
          note={t('subscriptions.stats.committedMonthlyNote', { amount: formatMoney(committedMonthly * 12) })}
          dataTour="subscriptions:committed"
        />
        <StatCard compact icon={<CheckCircle2 />} label={t('subscriptions.stats.active')} value={String(active.length)} />
        <StatCard
          compact
          icon={<PauseCircle />}
          label={t('subscriptions.stats.paused')}
          value={String(paused.length)}
          valueClassName="text-[color:var(--nl-warning-ink)]"
        />
        <StatCard
          compact
          icon={<XCircle />}
          label={t('subscriptions.stats.cancelled')}
          value={String(cancelled.length)}
          valueClassName="text-muted-foreground"
        />
      </div>

      <div className="bg-card border border-border rounded-md p-4 mb-4" data-tour="subscriptions:renewals">
        <div className="text-[15px] font-medium mb-2">{t('subscriptions.renewalsSection.heading')}</div>
        {upcomingRenewals.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('subscriptions.renewalsSection.empty')}</p>
        ) : (
          upcomingRenewals.map((item) => (
            <div key={item.id} className="flex items-center gap-2 lg:gap-3 py-2 border-t border-border first:border-0">
              <CalendarClock size={14} className="text-muted-foreground flex-shrink-0" />
              <span className="text-[13px] font-medium flex-1 min-w-0 truncate">{item.name}</span>
              <span className="text-[13px] text-muted-foreground w-16 lg:w-24 text-right flex-shrink-0">
                {formatShortDate(item.next_date)}
              </span>
              <span className="text-[13px] w-20 lg:w-28 text-right flex-shrink-0">{formatMoney(item.amount)}</span>
            </div>
          ))
        )}
      </div>

      <div className="bg-card border border-border rounded-md p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div className="text-[15px] font-medium">{t('subscriptions.listSection.heading')}</div>
          <div data-tour="subscriptions:status-filter">
            <SegmentedControl
              value={status}
              onChange={setStatus}
              options={[
                { value: 'active', label: t('subscriptions.listSection.filter.active') },
                { value: 'paused', label: t('subscriptions.listSection.filter.paused') },
                { value: 'cancelled', label: t('subscriptions.listSection.filter.cancelled') },
                { value: 'all', label: t('subscriptions.listSection.filter.all') },
              ]}
            />
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t('subscriptions.listSection.loading')}</p>
        ) : visible.length === 0 ? (
          <EmptyState>
            {status === 'active'
              ? t('subscriptions.listSection.emptyActive')
              : status === 'paused'
                ? t('subscriptions.listSection.emptyPaused')
                : status === 'cancelled'
                  ? t('subscriptions.listSection.emptyCancelled')
                  : t('subscriptions.listSection.emptyAll')}
          </EmptyState>
        ) : (
          <>
            <div className="hidden lg:grid grid-cols-[2fr_1.2fr_1fr_1fr_230px] gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              <span>{t('subscriptions.listSection.table.name')}</span>
              <span>{t('subscriptions.listSection.table.charge')}</span>
              <span className="text-right">{t('subscriptions.listSection.table.monthlyEquivalent')}</span>
              <span className="text-right">{t('subscriptions.listSection.table.nextDate')}</span>
              <span className="text-right">{t('subscriptions.listSection.table.statusAction')}</span>
            </div>
            {visible.map((item) => {
              const category = categories?.find((c) => c.id === item.category_id)
              return (
                <SubscriptionRow
                  key={item.id}
                  item={item}
                  categoryName={category?.name ?? t('subscriptions.fallbackCategoryName')}
                  categoryColor={category?.color ?? FALLBACK_CATEGORY_COLOR}
                />
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
