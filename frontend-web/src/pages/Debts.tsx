import { AlertTriangle, Check, Coins, Plus, Zap } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CategorySelect } from '@/components/nl/CategorySelect'
import { DialogPrimaryButton } from '@/components/nl/DialogActions'
import { DemoSteps, HelpSection, HelpTip } from '@/components/nl/Help'
import { HEADER_SECTIONS, SegmentedControl, StatCard, ViewHeader } from '@/components/nl/primitives'
import { Donut } from '@/lib/charts'
import { useAccounts } from '@/hooks/useAccounts'
import { useCategories } from '@/hooks/useCategories'
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

const DIRECTION_LABEL: Record<DebtDirection, string> = {
  owed_by_me: 'Yo debo',
  owed_to_me: 'Me deben',
}

const DEBT_TYPES: DebtType[] = [
  'credit_card',
  'personal_loan',
  'payroll_loan',
  'installment',
  'informal',
  'civic',
  'loan_received',
]

const FREQUENCIES: PaymentFrequency[] = ['weekly', 'biweekly', 'monthly', 'irregular']

function NewUnplannedDebtForm({
  direction,
  onDone,
}: {
  direction: DebtDirection
  onDone: () => void
}) {
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
      // error mostrado abajo
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">
          {direction === 'owed_to_me' ? '¿Quién te debe?' : '¿Quién te prestó?'}
        </label>
        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${selectClass} h-9 w-full`} />
      </div>
      {direction === 'owed_by_me' && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">Acreedor (opcional)</label>
          <input value={form.creditor} onChange={(e) => setForm({ ...form, creditor: e.target.value })} className={`${selectClass} h-9 w-full`} />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Monto estimado</label>
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
      <DialogPrimaryButton icon={Plus} pending={createUnplanned.isPending}>
        Registrar
      </DialogPrimaryButton>
    </form>
  )
}

function ActivateDebtForm({ debt, onDone }: { debt: UnplannedDebt; onDone: () => void }) {
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
      // error mostrado abajo
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Monto original: {formatMoney(debt.amount)}. Deja "monto acordado" vacío si no hubo quita.
      </p>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Monto acordado (si hubo quita)</label>
        <input
          type="number"
          step="0.01"
          value={form.agreed_amount}
          onChange={(e) => setForm({ ...form, agreed_amount: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Cuota</label>
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
        <label className="text-xs text-muted-foreground">Frecuencia</label>
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
            ? '¿De cuál cuenta salió el dinero? (opcional)'
            : '¿A cuál cuenta entró el dinero? (opcional)'}
        </label>
        <Select
          value={form.funding_account_id || null}
          onValueChange={(v) => setForm({ ...form, funding_account_id: v ?? '' })}
        >
          <SelectTrigger className="h-9 w-full">
            <SelectValue placeholder="Ninguna, ya lo traía antes de usar la app">
              {(v: string | null) => accounts?.find((a) => a.id === v)?.name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Ninguna</SelectItem>
            {accounts?.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Fecha de inicio</label>
        <input
          type="date"
          required
          value={form.start_date}
          onChange={(e) => setForm({ ...form, start_date: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      {activate.isError && <p className="text-sm text-destructive">{apiErrorMessage(activate.error)}</p>}
      <DialogPrimaryButton icon={Zap} pending={activate.isPending} pendingLabel="Activando...">
        Activar deuda
      </DialogPrimaryButton>
    </form>
  )
}

function NewDebtForm({ direction, onDone }: { direction: DebtDirection; onDone: () => void }) {
  const { data: accounts } = useAccounts()
  const { data: categories } = useCategories('expense')
  const createDebt = useCreateDebt()
  const [isMsi, setIsMsi] = useState(false)
  const isReceivable = direction === 'owed_to_me'

  const [form, setForm] = useState<CreateDebtInput>({
    name: '',
    type: isReceivable ? 'informal' : 'personal_loan',
    direction,
    total_amount: '',
    payment_amount: '',
    payment_frequency: 'monthly',
    funding_account_id: '',
  })
  const [categoryId, setCategoryId] = useState('')
  const [payingAccountId, setPayingAccountId] = useState('')
  // Validacion propia, distinta del error del servidor (createDebt.isError):
  // el backend igual la exige (debt_service.create_debt), pero avisar antes
  // de mandar la request evita el viaje redondo y el mensaje generico.
  const [formError, setFormError] = useState<string | null>(null)
  const needsLinkedAccount = !isReceivable && form.type === 'credit_card'

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    if (needsLinkedAccount && !form.linked_account_id) {
      setFormError('Selecciona la cuenta de la tarjeta -- si todavía no la das de alta, créala primero en Cuentas.')
      return
    }
    try {
      await createDebt.mutateAsync({
        ...form,
        funding_account_id: form.funding_account_id || undefined,
        linked_account_id: form.linked_account_id || undefined,
        initial_charge: isMsi
          ? {
              category_id: categoryId,
              paying_account_id: payingAccountId,
              description: `Compra MSI: ${form.name}`,
            }
          : undefined,
      })
      onDone()
    } catch {
      // error mostrado abajo
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">
          {isReceivable ? '¿A quién le prestas?' : 'Nombre'}
        </label>
        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${selectClass} h-9 w-full`} />
      </div>
      {!isReceivable && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">Tipo</label>
          <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: (v as DebtType) ?? 'personal_loan' })}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue>{(v: DebtType) => debtTypeLabel(v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {DEBT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {debtTypeLabel(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Monto total</label>
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
        <label className="text-xs text-muted-foreground">Cuota (opcional)</label>
        <input
          type="number"
          step="0.01"
          value={form.payment_amount}
          onChange={(e) => setForm({ ...form, payment_amount: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Frecuencia</label>
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
      {needsLinkedAccount && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">
            Cuenta vinculada (la TDC real) -- obligatoria
          </label>
          {accounts && accounts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Todavía no tienes cuentas.{' '}
              <Link to="/accounts" className="underline hover:no-underline">
                Crea la tarjeta en Cuentas
              </Link>{' '}
              y regresa aquí.
            </p>
          ) : (
            <Select
              value={form.linked_account_id || null}
              onValueChange={(v) => setForm({ ...form, linked_account_id: v ?? '' })}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder="Selecciona la tarjeta">
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
          )}
        </div>
      )}
      {(isReceivable || form.type !== 'credit_card') && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">
            {isReceivable
              ? '¿De cuál cuenta sale el dinero? (opcional)'
              : '¿A cuál cuenta entró el dinero? (opcional)'}
          </label>
          <Select
            value={form.funding_account_id || null}
            onValueChange={(v) => setForm({ ...form, funding_account_id: v ?? '' })}
          >
            <SelectTrigger className="h-9 w-full">
              <SelectValue placeholder="Ninguna, ya lo traía antes de usar la app">
                {(v: string | null) => accounts?.find((a) => a.id === v)?.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Ninguna</SelectItem>
              {accounts?.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {!isReceivable && form.type === 'installment' && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isMsi} onChange={(e) => setIsMsi(e.target.checked)} />
          Es una compra a meses (MSI): también registrar el cargo inicial
        </label>
      )}

      {isMsi && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Categoría del gasto</label>
            <CategorySelect
              categories={categories}
              value={categoryId}
              onValueChange={setCategoryId}
              placeholder="Selecciona categoría"
              triggerClassName="h-9 w-full"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">TDC donde se cargó</label>
            <Select value={payingAccountId || null} onValueChange={(v) => setPayingAccountId(v ?? '')}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder="Selecciona cuenta">
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
        </>
      )}

      {formError && <p className="text-sm text-destructive">{formError}</p>}
      {createDebt.isError && <p className="text-sm text-destructive">{apiErrorMessage(createDebt.error)}</p>}
      <DialogPrimaryButton
        icon={Check}
        pending={createDebt.isPending}
        disabled={needsLinkedAccount && accounts?.length === 0}
      >
        Crear deuda
      </DialogPrimaryButton>
    </form>
  )
}

/** Si la TDC quedo creada sin cuenta vinculada (NewDebtForm ya lo exige para
 * deudas nuevas, pero esto resuelve las que ya hayan quedado asi -- ver
 * debt_service._resolve_debt_side_account), el pago no se puede registrar
 * hasta asignarla. En vez de mandar al usuario a buscar donde arreglarlo (no
 * habia donde, ver bug reportado), se resuelve aqui mismo con useUpdateDebt
 * y se sigue directo al formulario de pago normal. */
function ResolveLinkedAccountForm({ debt, onResolved }: { debt: Debt; onResolved: () => void }) {
  const { data: accounts } = useAccounts()
  const updateDebt = useUpdateDebt()
  const [linkedAccountId, setLinkedAccountId] = useState('')

  async function handleAssign() {
    if (!linkedAccountId) return
    try {
      await updateDebt.mutateAsync({ id: debt.id, input: { linked_account_id: linkedAccountId } })
      onResolved()
    } catch {
      // error mostrado abajo
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Esta tarjeta todavía no tiene una cuenta vinculada -- necesitamos saber cuál es antes de poder
        registrar el pago.
      </p>
      {accounts && accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no tienes cuentas.{' '}
          <Link to="/accounts" className="underline hover:no-underline">
            Crea la tarjeta en Cuentas
          </Link>{' '}
          y regresa aquí.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Cuenta de esta tarjeta</label>
            <Select value={linkedAccountId || null} onValueChange={(v) => setLinkedAccountId(v ?? '')}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder="Selecciona una cuenta">
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
          {updateDebt.isError && <p className="text-sm text-destructive">{apiErrorMessage(updateDebt.error)}</p>}
          <DialogPrimaryButton
            type="button"
            onClick={handleAssign}
            icon={Check}
            pending={updateDebt.isPending}
            pendingLabel="Asignando..."
            disabled={!linkedAccountId}
          >
            Asignar y continuar
          </DialogPrimaryButton>
        </>
      )}
    </div>
  )
}

function RegisterPaymentForm({ debt, onDone }: { debt: Debt; onDone: () => void }) {
  const { data: accounts } = useAccounts()
  const registerPayment = useRegisterDebtPayment()
  const isReceivable = debt.direction === 'owed_to_me'
  const [accountId, setAccountId] = useState('')
  const [amount, setAmount] = useState(debt.payment_amount ?? '')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  // Resuelto en cuanto onResolved invalida ['debts'] y el `debt` de arriba
  // (viene del listado, no de un fetch propio de este form) llega con
  // linked_account_id ya asignado -- este flag solo cubre el instante entre
  // el click de "Asignar y continuar" y que ese refetch termine.
  const [justResolved, setJustResolved] = useState(false)

  if (debt.type === 'credit_card' && !debt.linked_account_id && !justResolved) {
    return <ResolveLinkedAccountForm debt={debt} onResolved={() => setJustResolved(true)} />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      await registerPayment.mutateAsync({ debtId: debt.id, input: { account_id: accountId, amount, date } })
      onDone()
    } catch {
      // error mostrado abajo
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {isReceivable ? 'Te debe' : 'Saldo actual'}: {formatMoney(debt.current_balance)}
      </p>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">
          {isReceivable ? 'Cuenta a la que entra el dinero' : 'Cuenta que paga'}
        </label>
        <Select value={accountId || null} onValueChange={(v) => setAccountId(v ?? '')}>
          <SelectTrigger className="h-9 w-full">
            <SelectValue placeholder="Selecciona una cuenta">
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
        <label className="text-xs text-muted-foreground">Monto</label>
        <input type="number" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className={`${selectClass} h-9 w-full`} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Fecha</label>
        <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={`${selectClass} h-9 w-full`} />
      </div>
      {registerPayment.isError && <p className="text-sm text-destructive">{apiErrorMessage(registerPayment.error)}</p>}
      <DialogPrimaryButton icon={Check} pending={registerPayment.isPending}>
        {isReceivable ? 'Registrar cobro' : 'Registrar pago'}
      </DialogPrimaryButton>
    </form>
  )
}

/** Ajuste directo de current_balance -- pensado para el flujo de backfill
 * historico (ver useDebts.ts UpdateDebtInput.current_balance): en vez de
 * registrar pago por pago de años atrás, se carga el historial de
 * transacciones que se tenga y al final se corrige el saldo pendiente a lo
 * que de verdad es hoy. No toca ningún pago ya registrado. */
function CorrectBalanceForm({ debt, onDone }: { debt: Debt; onDone: () => void }) {
  const updateDebt = useUpdateDebt()
  const confirm = useConfirmStore((s) => s.ask)
  const pushToast = useUiStore((s) => s.pushToast)
  const isReceivable = debt.direction === 'owed_to_me'
  const [balance, setBalance] = useState(debt.current_balance)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (Number(balance) === Number(debt.current_balance)) return onDone()
    const ok = await confirm({
      title: 'Corregir saldo',
      message:
        `Vas a cambiar el saldo de "${debt.name}" de ${formatMoney(debt.current_balance)} a ` +
        `${formatMoney(balance)} directamente -- no registra ningún pago ni modifica los que ya ` +
        `existen, solo ajusta el número. ¿Continuar?`,
      confirmLabel: 'Corregir saldo',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await updateDebt.mutateAsync({ id: debt.id, input: { current_balance: balance } })
      pushToast(`Saldo de "${debt.name}" actualizado`, 'success')
      onDone()
    } catch {
      // error mostrado abajo
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {isReceivable ? 'Te debe' : 'Saldo actual'}: {formatMoney(debt.current_balance)}
      </p>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Saldo correcto</label>
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
      <DialogPrimaryButton icon={Check} pending={updateDebt.isPending}>
        Guardar
      </DialogPrimaryButton>
    </form>
  )
}

function DebtCard({ debt }: { debt: Debt }) {
  const [payOpen, setPayOpen] = useState(false)
  const [correctOpen, setCorrectOpen] = useState(false)
  const isReceivable = debt.direction === 'owed_to_me'
  const paidRatio = Number(debt.total_amount) > 0 ? 1 - Number(debt.current_balance) / Number(debt.total_amount) : 0
  const apr = debt.interest_rate ? Number(debt.interest_rate) * 100 : 0
  const risk = !isReceivable && apr > 25
  const balanceColor = isReceivable ? 'var(--nl-accent-ink)' : 'var(--nl-danger-ink)'

  return (
    <div
      className="bg-card border rounded-md p-4"
      style={{
        borderColor: risk ? 'var(--nl-danger)' : 'var(--nl-border)',
        boxShadow: risk ? '0 0 16px rgba(240,78,78,0.15)' : 'none',
      }}
    >
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[13px] font-semibold">{debt.name}</span>
        <span className="rounded-full px-2.5 py-0.5 text-[10px]" style={{ background: 'var(--nl-bg-track)' }}>
          {isReceivable ? 'te debe' : debtTypeLabel(debt.type)}
        </span>
      </div>
      <div className="flex items-center gap-4 mb-2.5">
        <Donut
          slices={[
            { value: paidRatio, color: 'var(--nl-accent)' },
            { value: 1 - paidRatio, color: 'var(--nl-bg-track)' },
          ]}
          size={64}
          strokeWidth={9}
          centerLabel={`${Math.round(paidRatio * 100)}%`}
        />
        <div className="flex-1">
          <div className="text-[11px] text-muted-foreground">{isReceivable ? 'Cobrado' : 'TAE'}</div>
          {isReceivable ? (
            <div className="text-[20px] font-light">{Math.round(paidRatio * 100)}%</div>
          ) : (
            <div className="text-[20px] font-light" style={{ color: apr > 25 ? 'var(--nl-danger-ink)' : undefined }}>
              {debt.interest_rate ? `${apr.toFixed(1)}%` : '—'}
            </div>
          )}
        </div>
      </div>
      <div className="mb-2.5">
        <div className="text-[11px] text-muted-foreground">{isReceivable ? 'Te debe' : 'Saldo'}</div>
        <div className="text-lg font-light" style={{ color: balanceColor }}>
          {formatMoney(debt.current_balance)}
        </div>
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <div className="text-[11px] text-muted-foreground">
          {debt.status === 'completed' ? 'Liquidada' : `Próximo: ${debt.next_payment_date ?? '—'}`}
        </div>
        {debt.status === 'active' && (
          <div className="flex items-center gap-2">
            <Dialog open={correctOpen} onOpenChange={setCorrectOpen}>
              <DialogTrigger
                render={
                  <button
                    type="button"
                    data-tour="debts:correct-balance"
                    className="rounded px-3 py-1.5 text-[12px] border border-border text-muted-foreground hover:text-foreground"
                  >
                    Corregir saldo
                  </button>
                }
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Corregir saldo — {debt.name}</DialogTitle>
                </DialogHeader>
                <CorrectBalanceForm debt={debt} onDone={() => setCorrectOpen(false)} />
              </DialogContent>
            </Dialog>
            <Dialog open={payOpen} onOpenChange={setPayOpen}>
              <DialogTrigger
                render={
                  <button
                    type="button"
                    className="rounded px-3 py-1.5 text-[12px] border border-border text-muted-foreground hover:text-foreground"
                  >
                    {isReceivable ? 'Registrar cobro' : 'Registrar pago'}
                  </button>
                }
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {isReceivable ? 'Cobro' : 'Pago'} — {debt.name}
                  </DialogTitle>
                </DialogHeader>
                <RegisterPaymentForm debt={debt} onDone={() => setPayOpen(false)} />
              </DialogContent>
            </Dialog>
          </div>
        )}
        {debt.status === 'completed' && (
          <span className="rounded-full px-2.5 py-0.5 text-[10px]" style={{ background: 'var(--nl-accent-soft-bg)', color: 'var(--nl-accent-ink)' }}>
            Liquidada
          </span>
        )}
      </div>
    </div>
  )
}

function UnplannedDebtRow({ unplanned }: { unplanned: UnplannedDebt }) {
  const [activateOpen, setActivateOpen] = useState(false)
  const isDesktop = useIsDesktop()

  // Un solo Dialog con estado local -- ver mismo comentario en
  // RecurringItemRow (pages/Recurring.tsx). isDesktop decide cual layout se
  // monta, nunca los dos a la vez.
  const activateDialog = (
    <Dialog open={activateOpen} onOpenChange={setActivateOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            data-tour="debts:activate-button"
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-[12px] font-medium"
            style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
          >
            <Zap size={13} />
            Activar
          </button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Activar — {unplanned.name}</DialogTitle>
        </DialogHeader>
        <ActivateDebtForm debt={unplanned} onDone={() => setActivateOpen(false)} />
      </DialogContent>
    </Dialog>
  )

  if (isDesktop) {
    return (
      <div className="grid grid-cols-[2fr_1fr_1fr_100px] gap-2 items-center py-2.5 border-t border-border first:border-0 text-[13px]">
        <span className="font-medium truncate">{unplanned.name}</span>
        <span className="text-muted-foreground">{unplanned.creditor ?? '—'}</span>
        <span className="text-right">{formatMoney(unplanned.amount)}</span>
        <span className="text-right">{activateDialog}</span>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-2 py-2.5 border-t border-border first:border-0 text-[13px]">
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
  return (
    <>
      <HelpSection heading="Qué es esta pantalla">
        <p>
          Todo lo que involucra deber dinero, en cualquier dirección: tarjetas de crédito, préstamos
          personales, nómina, crédito de tienda, o algo tan informal como que le prestaste $100 a un
          amigo o tu abuelo te prestó $100,000. La pestaña de arriba cambia entre{' '}
          <strong>Yo debo</strong> y <strong>Me deben</strong> — mismo modelo, misma pantalla, solo
          cambia quién le debe a quién.
        </p>
      </HelpSection>
      <HelpSection heading="Agregar deuda">
        <p>
          Registra una deuda con su plan completo: monto, frecuencia de pago y, opcionalmente, de/a qué
          cuenta se movió el efectivo cuando se originó. En "Yo debo" también eliges el tipo (tarjeta,
          préstamo personal, informal, etc.) — en "Me deben" siempre es un préstamo informal.
        </p>
      </HelpSection>
      <HelpSection heading="Deuda sin plan">
        <p>
          Para cuando todavía no tienes el detalle claro — solo nombre y monto. Nunca mueve dinero de
          ninguna cuenta. Cuando ya sepas cómo se va a pagar, la "activas" con un plan (y ahí sí puedes
          decir de qué cuenta salió/entró el efectivo, si aplica).
        </p>
        <p>
          Esta sección está apagada por default — solo aparece si activas "Tengo una deuda con problemas
          de pago" en Ajustes. Al activarla, el asesor de IA también puede ver estas deudas y ayudarte a
          analizar cómo pagarlas.
        </p>
        <DemoSteps
          steps={[
            'Deuda sin plan: guarda el nombre y el monto, sin más detalle.',
            'Cuando decidas cómo pagarla, la activas con monto/frecuencia/cuenta.',
            'A partir de ahí se comporta como cualquier otra deuda.',
          ]}
        />
      </HelpSection>
      <HelpSection heading="Registrar pago / cobro">
        <p>
          Baja el saldo pendiente y mueve dinero real de/hacia la cuenta que elijas — es una transacción
          real, no solo un número que cambia. En "Me deben" se llama "Registrar cobro" (te están
          pagando), en "Yo debo" es "Registrar pago".
        </p>
      </HelpSection>
      <HelpSection heading="Corregir saldo">
        <p>
          Ajusta el saldo pendiente directamente a lo que de verdad es hoy, sin registrar pago por pago —
          pensado para cuando estás cargando historial viejo y solo necesitas dejar el número correcto al
          final. A diferencia de "Registrar pago", no mueve dinero de ninguna cuenta ni afecta pagos ya
          registrados.
        </p>
      </HelpSection>
      <HelpTip>
        Prestar o que te presten no es un gasto ni un ingreso — tu patrimonio total no cambia, solo se
        mueve de una cuenta a otra (o a esta lista, si todavía no tiene cuenta asociada).
      </HelpTip>
    </>
  )
}

export function Debts() {
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
  // Si ya hay deudas sin plan de datos previos a activar el toggle, se
  // siguen mostrando -- el toggle gatea la ENTRADA a la feature, no esconde
  // datos que el usuario ya registro.
  const showUnplannedSection = debtTroubleMode || unplanned.length > 0

  return (
    <div>
      <ViewHeader
        icon={<Coins />}
        title="Deudas"
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
                      Deuda sin plan
                    </button>
                  }
                />
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Registrar deuda sin plan</DialogTitle>
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
                    Agregar deuda
                  </button>
                }
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Nueva deuda</DialogTitle>
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
            label: DIRECTION_LABEL[d],
          }))}
          className="mb-5"
        />
      </div>

      <div className="grid grid-cols-2 gap-2.5 mb-4 lg:flex lg:gap-3 lg:flex-wrap" data-tour="debts:summary">
        {isReceivable ? (
          <>
            <StatCard
              compact
              label="Me deben en total"
              value={formatMoney(summary?.total_owed_to_me ?? '0')}
              valueClassName="text-[color:var(--nl-accent-ink)]"
            />
            {debtTroubleMode && (
              <StatCard
                compact
                label="Sin plan"
                value={formatMoney(summary?.unplanned_owed_to_me ?? '0')}
                valueClassName="text-[color:var(--nl-warning-ink)]"
              />
            )}
          </>
        ) : (
          <>
            <StatCard
              compact
              label="Debo en total"
              value={formatMoney(summary?.total_owed_by_me ?? '0')}
              valueClassName="text-[color:var(--nl-danger-ink)]"
            />
            <StatCard compact label="Compromiso / mes" value={formatMoney(summary?.monthly_committed ?? '0')} />
            {debtTroubleMode && (
              <StatCard
                compact
                label="Sin plan"
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
          ¿Tienes una deuda vencida o con problemas de pago? Actívalo en Ajustes.
        </Link>
      )}

      {!loadingUnplanned && showUnplannedSection && unplanned.length > 0 && (
        <div className="bg-card border border-border rounded-md p-4 mb-4">
          <div className="text-[15px] font-medium mb-1">Sin plan de pago</div>
          <div className="hidden lg:grid grid-cols-[2fr_1fr_1fr_100px] gap-2 text-[11px] uppercase tracking-wide text-muted-foreground mt-3">
            <span>Nombre</span>
            <span>Acreedor</span>
            <span className="text-right">Monto</span>
            <span className="text-right">Acción</span>
          </div>
          {unplanned.map((u) => (
            <UnplannedDebtRow key={u.id} unplanned={u} />
          ))}
        </div>
      )}

      <div className="text-sm font-semibold mb-2">Con plan activo</div>
      {loadingDebts ? (
        <p className="text-sm text-muted-foreground">Cargando...</p>
      ) : activeDebts.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeDebts.map((debt) => (
            <DebtCard key={debt.id} debt={debt} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {isReceivable
            ? 'Nadie te debe dinero con un plan activo.'
            : 'No tienes deudas con plan de pago activo.'}
        </p>
      )}
    </div>
  )
}
