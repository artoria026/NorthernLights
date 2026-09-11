import {
  AlertTriangle,
  Briefcase,
  Calendar,
  Check,
  Coins,
  HandCoins,
  Landmark,
  Plus,
  Scale,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DialogFooter, DialogPrimaryButton } from '@/components/nl/DialogActions'
import { DemoSteps, HelpSection, HelpTip } from '@/components/nl/Help'
import { HEADER_SECTIONS, SegmentedControl, ViewHeader } from '@/components/nl/primitives'
import { Donut } from '@/lib/charts'
import { useAccounts } from '@/hooks/useAccounts'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import {
  type ActivateDebtInput,
  type CreateDebtInput,
  type CreateUnplannedDebtInput,
  useActivateUnplannedDebt,
  useCreateDebt,
  useCreateUnplannedDebt,
  useDebtSummary,
  useDebts,
  useRegisterDebtPayment,
  useUnplannedDebts,
  useUpdateDebt,
} from '@/hooks/useDebts'
import { apiErrorMessage } from '@/services/api'
import { debtTypeLabel, formatMoney, paymentFrequencyLabel, selectClass } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { useConfirmStore } from '@/stores/confirmStore'
import { useUiStore } from '@/stores/uiStore'
import type { Debt, DebtDirection, DebtType, PaymentFrequency, UnplannedDebt } from '@/types'

const DEBT_TYPES: DebtType[] = [
  'personal_loan',
  'payroll_loan',
  'informal',
  'civic',
  'loan_received',
]

const FREQUENCIES: PaymentFrequency[] = ['weekly', 'biweekly', 'monthly', 'irregular']

/** Icon + color per type -- purely categorical (identifies at a glance,
 * doesn't imply risk/status; that's already covered by DebtCard's red
 * border when the APR goes over 25%). "Owed to me" is always informal, but
 * uses its own icon (people who owe you, not your loan) via isReceivable
 * instead of this map. */
const DEBT_TYPE_ICONS: Record<DebtType, LucideIcon> = {
  personal_loan: Wallet,
  payroll_loan: Briefcase,
  informal: Users,
  civic: Landmark,
  loan_received: HandCoins,
}
const DEBT_TYPE_COLORS: Record<DebtType, { bg: string; ink: string }> = {
  personal_loan: { bg: 'var(--nl-blue-soft-bg)', ink: 'var(--nl-blue-ink)' },
  payroll_loan: { bg: 'var(--nl-violet-soft-bg)', ink: 'var(--nl-violet-ink)' },
  informal: { bg: 'var(--nl-warning-soft-bg)', ink: 'var(--nl-warning-ink)' },
  civic: { bg: 'var(--nl-accent-soft-bg)', ink: 'var(--nl-accent-ink)' },
  loan_received: { bg: 'var(--nl-blue-soft-bg)', ink: 'var(--nl-blue-ink)' },
}

function NewUnplannedDebtForm({
  direction,
  onDone,
}: {
  direction: DebtDirection
  onDone: () => void
}) {
  const { t } = useTranslation('pages')
  const createUnplanned = useCreateUnplannedDebt()
  const [form, setForm] = useState<CreateUnplannedDebtInput>({
    name: '',
    creditor: '',
    amount: '',
    direction,
  })

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      await createUnplanned.mutateAsync(form)
      onDone()
    } catch {
      // error shown below
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">
          {direction === 'owed_to_me' ? t('debts.newUnplannedForm.whoOwesYouLabel') : t('debts.newUnplannedForm.whoLentLabel')}
        </label>
        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${selectClass} h-9 w-full`} />
      </div>
      {direction === 'owed_by_me' && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">{t('debts.newUnplannedForm.creditorLabel')}</label>
          <input value={form.creditor} onChange={(e) => setForm({ ...form, creditor: e.target.value })} className={`${selectClass} h-9 w-full`} />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t('debts.newUnplannedForm.amountLabel')}</label>
        <input
          type="number"
          step="0.01"
          required
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      {createUnplanned.isError && <p className="text-sm text-destructive">{apiErrorMessage(createUnplanned.error)}</p>}
      <DialogFooter>
        <DialogPrimaryButton icon={Plus} pending={createUnplanned.isPending}>
          {t('debts.newUnplannedForm.submitButton')}
        </DialogPrimaryButton>
      </DialogFooter>
    </form>
  )
}

function ActivateDebtForm({ debt, onDone }: { debt: UnplannedDebt; onDone: () => void }) {
  const { t } = useTranslation('pages')
  const { data: accounts } = useAccounts()
  const activate = useActivateUnplannedDebt()
  const [form, setForm] = useState<ActivateDebtInput>({
    agreed_amount: '',
    payment_amount: '',
    payment_frequency: 'monthly',
    funding_account_id: '',
    start_date: new Date().toISOString().slice(0, 10),
  })

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      await activate.mutateAsync({
        id: debt.id,
        input: {
          ...form,
          agreed_amount: form.agreed_amount || undefined,
          funding_account_id: form.funding_account_id || undefined,
        },
      })
      onDone()
    } catch {
      // error shown below
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t('debts.activateForm.originalAmountNote', { amount: formatMoney(debt.amount) })}
      </p>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t('debts.activateForm.agreedAmountLabel')}</label>
        <input
          type="number"
          step="0.01"
          value={form.agreed_amount}
          onChange={(e) => setForm({ ...form, agreed_amount: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t('debts.activateForm.paymentAmountLabel')}</label>
        <input
          type="number"
          step="0.01"
          required
          value={form.payment_amount}
          onChange={(e) => setForm({ ...form, payment_amount: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t('debts.activateForm.frequencyLabel')}</label>
        <Select
          value={form.payment_frequency}
          onValueChange={(v) => setForm({ ...form, payment_frequency: (v as PaymentFrequency) ?? 'monthly' })}
        >
          <SelectTrigger className="h-9 w-full">
            <SelectValue>{(v: PaymentFrequency) => paymentFrequencyLabel(v)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {FREQUENCIES.map((f) => (
              <SelectItem key={f} value={f}>
                {paymentFrequencyLabel(f)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">
          {debt.direction === 'owed_to_me'
            ? t('debts.activateForm.fundingAccountFromLabel')
            : t('debts.activateForm.fundingAccountToLabel')}
        </label>
        <Select
          value={form.funding_account_id || null}
          onValueChange={(v) => setForm({ ...form, funding_account_id: v ?? '' })}
        >
          <SelectTrigger className="h-9 w-full">
            <SelectValue placeholder={t('debts.activateForm.fundingAccountPlaceholder')}>
              {(v: string | null) => accounts?.find((a) => a.id === v)?.name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t('debts.activateForm.noneOption')}</SelectItem>
            {accounts?.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t('debts.activateForm.startDateLabel')}</label>
        <input
          type="date"
          required
          value={form.start_date}
          onChange={(e) => setForm({ ...form, start_date: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      {activate.isError && <p className="text-sm text-destructive">{apiErrorMessage(activate.error)}</p>}
      <DialogFooter>
        <DialogPrimaryButton icon={Zap} pending={activate.isPending} pendingLabel={t('debts.activateForm.pendingLabel')}>
          {t('debts.activateForm.submitButton')}
        </DialogPrimaryButton>
      </DialogFooter>
    </form>
  )
}

function NewDebtForm({ direction, onDone }: { direction: DebtDirection; onDone: () => void }) {
  const { t } = useTranslation('pages')
  const { data: accounts } = useAccounts()
  const createDebt = useCreateDebt()
  const isReceivable = direction === 'owed_to_me'

  const [form, setForm] = useState<
    Omit<CreateDebtInput, 'payment_frequency'> & {
      // '' is a real, intentional state here (no fixed frequency) -- not
      // the same as never having picked one, so it's kept distinct from
      // `undefined` until submit time (see handleSubmit).
      payment_frequency: PaymentFrequency | ''
      // Kept as the human-typed percentage (e.g. "10") separate from
      // CreateDebtInput's interest_rate, which the backend expects as a
      // decimal fraction ("0.10") -- converted only at submit time, same
      // pattern as interestRatePct in Accounts.tsx.
      interestRatePct: string
    }
  >({
    name: '',
    type: isReceivable ? 'informal' : 'personal_loan',
    direction,
    total_amount: '',
    payment_amount: '',
    // Receivables (money someone owes you, often informal) frequently have
    // no real payment schedule -- don't force one. Debts you owe more often
    // do have one, so 'monthly' stays a reasonable default there.
    payment_frequency: isReceivable ? '' : 'monthly',
    funding_account_id: '',
    interestRatePct: '',
  })

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      const { interestRatePct, ...rest } = form
      await createDebt.mutateAsync({
        ...rest,
        // Empty optional fields must become `undefined` (omitted), never
        // sent as "" -- the backend parses them as Decimal/enum and "" is
        // neither a valid number nor treated as absent, so it 422s instead
        // of just defaulting.
        payment_amount: form.payment_amount || undefined,
        payment_frequency: form.payment_frequency || undefined,
        funding_account_id: form.funding_account_id || undefined,
        interest_rate: interestRatePct ? String(parseFloat(interestRatePct) / 100) : undefined,
      })
      onDone()
    } catch {
      // error shown below
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">
          {isReceivable ? t('debts.newDebtForm.nameLabelReceivable') : t('debts.newDebtForm.nameLabel')}
        </label>
        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${selectClass} h-9 w-full`} />
      </div>
      {!isReceivable && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">{t('debts.newDebtForm.typeLabel')}</label>
          <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: (v as DebtType) ?? 'personal_loan' })}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue>{(v: DebtType) => debtTypeLabel(v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {DEBT_TYPES.map((dt) => (
                <SelectItem key={dt} value={dt}>
                  {debtTypeLabel(dt)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t('debts.newDebtForm.totalAmountLabel')}</label>
        <input
          type="number"
          step="0.01"
          required
          value={form.total_amount}
          onChange={(e) => setForm({ ...form, total_amount: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t('debts.newDebtForm.paymentAmountLabel')}</label>
        <input
          type="number"
          step="0.01"
          value={form.payment_amount}
          onChange={(e) => setForm({ ...form, payment_amount: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t('debts.newDebtForm.frequencyLabel')}</label>
        <Select
          value={form.payment_frequency || null}
          onValueChange={(v) => setForm({ ...form, payment_frequency: (v as PaymentFrequency) ?? '' })}
        >
          <SelectTrigger className="h-9 w-full">
            <SelectValue placeholder={t('debts.newDebtForm.noFrequencyOption')}>
              {(v: PaymentFrequency | null) => (v ? paymentFrequencyLabel(v) : t('debts.newDebtForm.noFrequencyOption'))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t('debts.newDebtForm.noFrequencyOption')}</SelectItem>
            {FREQUENCIES.map((f) => (
              <SelectItem key={f} value={f}>
                {paymentFrequencyLabel(f)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t('debts.newDebtForm.interestRateLabel')}</label>
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder={t('debts.newDebtForm.interestRatePlaceholder')}
          value={form.interestRatePct}
          onChange={(e) => setForm({ ...form, interestRatePct: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">
          {isReceivable
            ? t('debts.newDebtForm.fundingAccountFromLabel')
            : t('debts.newDebtForm.fundingAccountToLabel')}
        </label>
        <Select
          value={form.funding_account_id || null}
          onValueChange={(v) => setForm({ ...form, funding_account_id: v ?? '' })}
        >
          <SelectTrigger className="h-9 w-full">
            <SelectValue placeholder={t('debts.newDebtForm.fundingAccountPlaceholder')}>
              {(v: string | null) => accounts?.find((a) => a.id === v)?.name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t('debts.newDebtForm.noneOption')}</SelectItem>
            {accounts?.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {createDebt.isError && <p className="text-sm text-destructive">{apiErrorMessage(createDebt.error)}</p>}
      <DialogFooter>
        <DialogPrimaryButton icon={Check} pending={createDebt.isPending}>
          {t('debts.newDebtForm.submitButton')}
        </DialogPrimaryButton>
      </DialogFooter>
    </form>
  )
}

function RegisterPaymentForm({ debt, onDone }: { debt: Debt; onDone: () => void }) {
  const { t } = useTranslation('pages')
  const { data: accounts } = useAccounts()
  const registerPayment = useRegisterDebtPayment()
  const isReceivable = debt.direction === 'owed_to_me'
  const [accountId, setAccountId] = useState('')
  const [amount, setAmount] = useState(debt.payment_amount ?? '')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      await registerPayment.mutateAsync({ debtId: debt.id, input: { account_id: accountId, amount, date } })
      onDone()
    } catch {
      // error shown below
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {isReceivable
          ? t('debts.registerPaymentForm.oweYouNote', { amount: formatMoney(debt.current_balance) })
          : t('debts.registerPaymentForm.currentBalanceNote', { amount: formatMoney(debt.current_balance) })}
      </p>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">
          {isReceivable ? t('debts.registerPaymentForm.accountToLabel') : t('debts.registerPaymentForm.accountFromLabel')}
        </label>
        <Select value={accountId || null} onValueChange={(v) => setAccountId(v ?? '')}>
          <SelectTrigger className="h-9 w-full">
            <SelectValue placeholder={t('debts.registerPaymentForm.accountPlaceholder')}>
              {(v: string | null) => accounts?.find((a) => a.id === v)?.name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {accounts?.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t('debts.registerPaymentForm.amountLabel')}</label>
        <input type="number" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className={`${selectClass} h-9 w-full`} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t('debts.registerPaymentForm.dateLabel')}</label>
        <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={`${selectClass} h-9 w-full`} />
      </div>
      {registerPayment.isError && <p className="text-sm text-destructive">{apiErrorMessage(registerPayment.error)}</p>}
      <DialogFooter>
        <DialogPrimaryButton icon={Check} pending={registerPayment.isPending}>
          {isReceivable ? t('debts.registerPaymentForm.registerCollectionButton') : t('debts.registerPaymentForm.registerPaymentButton')}
        </DialogPrimaryButton>
      </DialogFooter>
    </form>
  )
}

/** Direct adjustment of current_balance -- meant for the historical
 * backfill flow (see useDebts.ts UpdateDebtInput.current_balance): instead
 * of registering payment after payment from years back, whatever
 * transaction history exists gets loaded and at the end the pending
 * balance is corrected to what it really is today. Doesn't touch any
 * already registered payment. */
function CorrectBalanceForm({ debt, onDone }: { debt: Debt; onDone: () => void }) {
  const { t } = useTranslation('pages')
  const updateDebt = useUpdateDebt()
  const confirm = useConfirmStore((s) => s.ask)
  const pushToast = useUiStore((s) => s.pushToast)
  const isReceivable = debt.direction === 'owed_to_me'
  const [balance, setBalance] = useState(debt.current_balance)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (Number(balance) === Number(debt.current_balance)) return onDone()
    const ok = await confirm({
      title: t('debts.correctBalanceForm.confirmTitle'),
      message: t('debts.correctBalanceForm.confirmMessage', {
        name: debt.name,
        from: formatMoney(debt.current_balance),
        to: formatMoney(balance),
      }),
      confirmLabel: t('debts.correctBalanceForm.confirmLabel'),
      variant: 'danger',
    })
    if (!ok) return
    try {
      await updateDebt.mutateAsync({ id: debt.id, input: { current_balance: balance } })
      pushToast(
        <Trans i18nKey="debts.toast.balanceUpdated" ns="pages" values={{ name: debt.name }}>
          Saldo de <strong className="font-bold" /> actualizado
        </Trans>,
        'success',
      )
      onDone()
    } catch {
      // error shown below
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {isReceivable
          ? t('debts.correctBalanceForm.oweYouNote', { amount: formatMoney(debt.current_balance) })
          : t('debts.correctBalanceForm.currentBalanceNote', { amount: formatMoney(debt.current_balance) })}
      </p>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t('debts.correctBalanceForm.balanceLabel')}</label>
        <input
          type="number"
          step="0.01"
          min="0"
          required
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      {updateDebt.isError && (
        <p className="text-sm text-destructive">{apiErrorMessage(updateDebt.error)}</p>
      )}
      <DialogFooter>
        <DialogPrimaryButton icon={Check} pending={updateDebt.isPending}>
          {t('debts.correctBalanceForm.submitButton')}
        </DialogPrimaryButton>
      </DialogFooter>
    </form>
  )
}

function DebtCard({ debt }: { debt: Debt }) {
  const { t } = useTranslation('pages')
  const [payOpen, setPayOpen] = useState(false)
  const [correctOpen, setCorrectOpen] = useState(false)
  const isReceivable = debt.direction === 'owed_to_me'
  const paidRatio = Number(debt.total_amount) > 0 ? 1 - Number(debt.current_balance) / Number(debt.total_amount) : 0
  const apr = debt.interest_rate ? Number(debt.interest_rate) * 100 : 0
  const risk = !isReceivable && apr > 25
  const balanceColor = isReceivable ? 'var(--nl-accent-ink)' : 'var(--nl-danger-ink)'
  const TypeIcon = isReceivable ? Users : DEBT_TYPE_ICONS[debt.type]
  const typeColor = isReceivable
    ? { bg: 'var(--nl-accent-soft-bg)', ink: 'var(--nl-accent-ink)' }
    : DEBT_TYPE_COLORS[debt.type]

  return (
    <div
      className="bg-card border rounded-md p-3"
      style={{
        borderColor: risk ? 'var(--nl-danger)' : 'var(--nl-border)',
        boxShadow: risk ? '0 0 12px rgba(240,78,78,0.15)' : 'none',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: typeColor.bg, color: typeColor.ink }}
        >
          <TypeIcon size={12} />
        </div>
        <span className="text-[12.5px] font-semibold flex-1 min-w-0 truncate" title={debt.name}>
          {debt.name}
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-[9px] flex-shrink-0"
          style={{ background: typeColor.bg, color: typeColor.ink }}
        >
          {isReceivable ? t('debts.card.receivableBadge') : debtTypeLabel(debt.type)}
        </span>
      </div>
      <div className="flex items-center gap-3 mb-2">
        <Donut
          slices={[
            { value: paidRatio, color: 'var(--nl-accent)' },
            { value: 1 - paidRatio, color: 'var(--nl-bg-track)' },
          ]}
          size={40}
          strokeWidth={5}
          centerLabel={`${Math.round(paidRatio * 100)}%`}
          centerFontSize={10}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">{isReceivable ? t('debts.card.collectedLabel') : t('debts.card.aprLabel')}</span>
            <span
              className="text-[13px] font-medium"
              style={{ color: !isReceivable && apr > 25 ? 'var(--nl-danger-ink)' : undefined }}
            >
              {isReceivable ? `${Math.round(paidRatio * 100)}%` : debt.interest_rate ? `${apr.toFixed(1)}%` : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">{isReceivable ? t('debts.card.oweYouLabel') : t('debts.card.balanceLabel')}</span>
            <span className="text-[13px] font-medium" style={{ color: balanceColor }}>
              {formatMoney(debt.current_balance)}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between pt-1.5 border-t border-border">
        <div className="text-[10px] text-muted-foreground truncate">
          {debt.status === 'completed'
            ? t('debts.card.completed')
            : t('debts.card.nextPayment', { date: debt.next_payment_date ?? '—' })}
        </div>
        {debt.status === 'active' && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <Dialog open={correctOpen} onOpenChange={setCorrectOpen}>
              <DialogTrigger
                render={
                  <button
                    type="button"
                    data-tour="debts:correct-balance"
                    className="flex items-center gap-1 rounded px-2 py-1 text-[11px] border border-border text-muted-foreground hover:text-foreground"
                  >
                    <Scale size={11} />
                    {t('debts.card.correctButton')}
                  </button>
                }
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('debts.card.correctDialogTitle', { name: debt.name })}</DialogTitle>
                </DialogHeader>
                <CorrectBalanceForm debt={debt} onDone={() => setCorrectOpen(false)} />
              </DialogContent>
            </Dialog>
            <Dialog open={payOpen} onOpenChange={setPayOpen}>
              <DialogTrigger
                render={
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded px-2 py-1 text-[11px] border border-border text-muted-foreground hover:text-foreground"
                  >
                    <Check size={11} />
                    {isReceivable ? t('debts.card.collectButton') : t('debts.card.payButton')}
                  </button>
                }
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {isReceivable
                      ? t('debts.card.collectionDialogTitle', { name: debt.name })
                      : t('debts.card.paymentDialogTitle', { name: debt.name })}
                  </DialogTitle>
                </DialogHeader>
                <RegisterPaymentForm debt={debt} onDone={() => setPayOpen(false)} />
              </DialogContent>
            </Dialog>
          </div>
        )}
        {debt.status === 'completed' && (
          <span className="rounded-full px-2 py-0.5 text-[9px]" style={{ background: 'var(--nl-accent-soft-bg)', color: 'var(--nl-accent-ink)' }}>
            {t('debts.card.completed')}
          </span>
        )}
      </div>
    </div>
  )
}

function UnplannedDebtRow({ unplanned }: { unplanned: UnplannedDebt }) {
  const { t } = useTranslation('pages')
  const [activateOpen, setActivateOpen] = useState(false)
  const isDesktop = useIsDesktop()

  // A single Dialog with local state -- see the same comment in
  // RecurringItemRow (pages/Recurring.tsx). isDesktop decides which layout
  // gets mounted, never both at once.
  const activateDialog = (
    <Dialog open={activateOpen} onOpenChange={setActivateOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            data-tour="debts:activate-button"
            className="flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium"
            style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
          >
            <Zap size={12} />
            {t('debts.unplannedRow.activateButton')}
          </button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('debts.unplannedRow.activateDialogTitle', { name: unplanned.name })}</DialogTitle>
        </DialogHeader>
        <ActivateDebtForm debt={unplanned} onDone={() => setActivateOpen(false)} />
      </DialogContent>
    </Dialog>
  )

  if (isDesktop) {
    return (
      <div className="grid grid-cols-[2fr_1fr_1fr_100px] gap-2 items-center py-1.5 border-t border-border first:border-0 text-[12.5px]">
        <span className="font-medium truncate">{unplanned.name}</span>
        <span className="text-muted-foreground">{unplanned.creditor ?? '—'}</span>
        <span className="text-right">{formatMoney(unplanned.amount)}</span>
        <span className="text-right">{activateDialog}</span>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-t border-border first:border-0 text-[12.5px]">
      <div className="min-w-0">
        <div className="font-medium truncate">{unplanned.name}</div>
        <div className="text-muted-foreground text-[12px] truncate">
          {unplanned.creditor ?? '—'} · {formatMoney(unplanned.amount)}
        </div>
      </div>
      <div className="flex-shrink-0">{activateDialog}</div>
    </div>
  )
}

function DebtsHelp() {
  const { t } = useTranslation('pages')
  return (
    <>
      <HelpSection heading={t('debts.help.whatIsThisScreen.heading')}>
        <p>
          <Trans i18nKey="debts.help.whatIsThisScreen.body" ns="pages">
            Everything that involves owing money, in either direction: personal loans, payroll loans,
            store credit, or something as informal as lending a friend $100 or your grandfather lending
            you $100,000. Credit cards don't live here -- they're paid off and you see the progress of
            your installment purchases from Accounts. The tab above switches between <strong>I owe</strong>{' '}
            and <strong>Owed to me</strong> — same model, same screen, only who owes whom changes.
          </Trans>
        </p>
      </HelpSection>
      <HelpSection heading={t('debts.help.addDebt.heading')}>
        <p>{t('debts.help.addDebt.body')}</p>
      </HelpSection>
      <HelpSection heading={t('debts.help.unplannedDebt.heading')}>
        <p>{t('debts.help.unplannedDebt.body1')}</p>
        <p>{t('debts.help.unplannedDebt.body2')}</p>
        <DemoSteps steps={t('debts.help.unplannedDebt.steps', { returnObjects: true }) as string[]} />
      </HelpSection>
      <HelpSection heading={t('debts.help.registerPayment.heading')}>
        <p>{t('debts.help.registerPayment.body')}</p>
      </HelpSection>
      <HelpSection heading={t('debts.help.correctBalance.heading')}>
        <p>{t('debts.help.correctBalance.body')}</p>
      </HelpSection>
      <HelpTip>{t('debts.help.tip')}</HelpTip>
    </>
  )
}

/** More compact version than StatCard (components/nl/primitives.tsx) --
 * StatCard is shared with Dashboard/Recurring/Budget and its "compact"
 * mode is already the standard there, shrinking it further would change
 * those screens too. This one lives only in Debts, matching the smaller
 * size the DebtCards below already have, without becoming illegible. */
function MiniStat({
  icon: Icon,
  label,
  value,
  valueClassName,
}: {
  icon: LucideIcon
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div className="flex-1 bg-card border border-border rounded-md min-w-0 p-2.5">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        <Icon size={14} strokeWidth={1.8} />
        <span className="text-[12px]">{label}</span>
      </div>
      <div className={`text-[18px] font-medium truncate ${valueClassName ?? ''}`}>{value}</div>
    </div>
  )
}

export function Debts() {
  const { t } = useTranslation('pages')
  const user = useAuthStore((s) => s.user)
  const debtTroubleMode = user?.debt_trouble_mode ?? false
  const [direction, setDirection] = useState<DebtDirection>('owed_by_me')
  const { data: summary } = useDebtSummary()
  const { data: unplannedAll, isLoading: loadingUnplanned } = useUnplannedDebts()
  const { data: debts, isLoading: loadingDebts } = useDebts(direction)
  const [unplannedOpen, setUnplannedOpen] = useState(false)
  const [debtOpen, setDebtOpen] = useState(false)

  const unplanned = unplannedAll?.filter((u) => u.direction === direction) ?? []
  const activeDebts = debts?.filter((d) => d.status !== 'completed') ?? []
  const isReceivable = direction === 'owed_to_me'
  // If there are already unplanned debts from before the toggle was
  // activated, they keep showing -- the toggle gates ENTRY into the
  // feature, it doesn't hide data the user already registered.
  const showUnplannedSection = debtTroubleMode || unplanned.length > 0

  const directionLabel: Record<DebtDirection, string> = {
    owed_by_me: t('debts.directions.owedByMe'),
    owed_to_me: t('debts.directions.owedToMe'),
  }

  return (
    <div>
      <ViewHeader
        icon={<Coins />}
        title={t('debts.title')}
        help={<DebtsHelp />}
        section={HEADER_SECTIONS.compromisos}
        tourKey="debts"
        actions={
          <>
            {debtTroubleMode && (
              <Dialog open={unplannedOpen} onOpenChange={setUnplannedOpen}>
                <DialogTrigger
                  render={
                    <button
                      type="button"
                      data-tour="debts:unplanned-button"
                      className="flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[13px] border border-border text-muted-foreground hover:text-foreground"
                    >
                      <Plus size={14} />
                      {t('debts.header.unplannedButton')}
                    </button>
                  }
                />
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t('debts.header.unplannedDialogTitle')}</DialogTitle>
                  </DialogHeader>
                  <NewUnplannedDebtForm direction={direction} onDone={() => setUnplannedOpen(false)} />
                </DialogContent>
              </Dialog>
            )}
            <Dialog open={debtOpen} onOpenChange={setDebtOpen}>
              <DialogTrigger
                render={
                  <button
                    type="button"
                    data-tour="debts:new-button"
                    className="flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[13px] font-medium"
                    style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
                  >
                    <Plus size={14} />
                    {t('debts.header.newDebtButton')}
                  </button>
                }
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('debts.header.newDebtDialogTitle')}</DialogTitle>
                </DialogHeader>
                <NewDebtForm direction={direction} onDone={() => setDebtOpen(false)} />
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <div data-tour="debts:direction-toggle">
        <SegmentedControl
          value={direction}
          onChange={setDirection}
          options={(['owed_by_me', 'owed_to_me'] as DebtDirection[]).map((d) => ({
            value: d,
            label: directionLabel[d],
          }))}
          className="mb-5"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3 lg:flex lg:gap-2.5 lg:flex-wrap" data-tour="debts:summary">
        {isReceivable ? (
          <>
            <MiniStat
              icon={TrendingUp}
              label={t('debts.stats.totalOwedToMe')}
              value={formatMoney(summary?.total_owed_to_me ?? '0')}
              valueClassName="text-[color:var(--nl-accent-ink)]"
            />
            {debtTroubleMode && (
              <MiniStat
                icon={AlertTriangle}
                label={t('debts.stats.unplanned')}
                value={formatMoney(summary?.unplanned_owed_to_me ?? '0')}
                valueClassName="text-[color:var(--nl-warning-ink)]"
              />
            )}
          </>
        ) : (
          <>
            <MiniStat
              icon={TrendingDown}
              label={t('debts.stats.totalOwedByMe')}
              value={formatMoney(summary?.total_owed_by_me ?? '0')}
              valueClassName="text-[color:var(--nl-danger-ink)]"
            />
            <MiniStat
              icon={Calendar}
              label={t('debts.stats.monthlyCommitment')}
              value={formatMoney(summary?.monthly_committed ?? '0')}
            />
            {debtTroubleMode && (
              <MiniStat
                icon={AlertTriangle}
                label={t('debts.stats.unplanned')}
                value={formatMoney(summary?.unplanned_owed_by_me ?? '0')}
                valueClassName="text-[color:var(--nl-warning-ink)]"
              />
            )}
          </>
        )}
      </div>

      {!debtTroubleMode && (
        <Link
          to="/settings"
          className="flex items-center gap-2 text-[12px] text-muted-foreground hover:text-foreground mb-4 -mt-1"
        >
          <AlertTriangle size={13} className="flex-shrink-0" />
          {t('debts.troubleModeCta')}
        </Link>
      )}

      {!loadingUnplanned && showUnplannedSection && unplanned.length > 0 && (
        <div className="bg-card border border-border rounded-md p-3 mb-3">
          <div className="text-[13.5px] font-medium mb-1">{t('debts.unplannedSection.heading')}</div>
          <div className="hidden lg:grid grid-cols-[2fr_1fr_1fr_100px] gap-2 text-[10.5px] uppercase tracking-wide text-muted-foreground mt-2">
            <span>{t('debts.unplannedSection.nameHeader')}</span>
            <span>{t('debts.unplannedSection.creditorHeader')}</span>
            <span className="text-right">{t('debts.unplannedSection.amountHeader')}</span>
            <span className="text-right">{t('debts.unplannedSection.actionHeader')}</span>
          </div>
          {unplanned.map((u) => (
            <UnplannedDebtRow key={u.id} unplanned={u} />
          ))}
        </div>
      )}

      <div className="text-sm font-semibold mb-2">{t('debts.activeSection.heading')}</div>
      {loadingDebts ? (
        <p className="text-sm text-muted-foreground">{t('debts.activeSection.loading')}</p>
      ) : activeDebts.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {activeDebts.map((debt) => (
            <DebtCard key={debt.id} debt={debt} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {isReceivable ? t('debts.activeSection.emptyReceivable') : t('debts.activeSection.emptyPayable')}
        </p>
      )}
    </div>
  )
}
