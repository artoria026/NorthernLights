import { Building2, Check, CreditCard, Landmark, Pencil, PiggyBank, Plus, Scale, Trash2, Wallet } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { Link } from 'react-router-dom'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DialogPrimaryButton } from '@/components/nl/DialogActions'
import { HelpSection, HelpTip } from '@/components/nl/Help'
import { CategoryBadge, HEADER_SECTIONS, SegmentedControl, ViewHeader } from '@/components/nl/primitives'
import { Sparkline } from '@/lib/charts'
import { fileToNormalizedDataUrl, validateImageFile } from '@/lib/image'
import {
  type CreateAccountInput,
  type UpdateAccountInput,
  useAccountSummary,
  useAccounts,
  useCreateAccount,
  useDeleteAccount,
  useReconcileAccount,
  useTdcCycle,
  useUpdateAccount,
} from '@/hooks/useAccounts'
import { useCategories } from '@/hooks/useCategories'
import { useTransactions } from '@/hooks/useTransactions'
import { apiErrorMessage } from '@/services/api'
import { accountSubtypeLabel, amountColor, entryTypeLabel, formatMoney, selectClass } from '@/lib/utils'
import { useConfirmStore } from '@/stores/confirmStore'
import { useTransactionModalStore } from '@/stores/transactionModalStore'
import { useUiStore } from '@/stores/uiStore'
import type { Account, Transaction } from '@/types'

type Segment = 'ALL' | 'IN' | 'OUT'

// Subtipos donde "contar lo que tienes fisicamente" tiene sentido -- mismo
// criterio que account_service.LIQUID_SUBTYPES en el backend (que es quien
// realmente lo valida; esto solo evita mostrar el boton donde el POST
// /reconcile respondería 400 de todos modos).
const RECONCILABLE_SUBTYPES = new Set(['cash', 'checking', 'savings'])

/** Tipos de cuenta que el usuario puede crear desde el wizard. Los tipos
 * contables internos (income/expense/equity, y el ledger oculto de deudas
 * informales) nunca se exponen aqui -- ver "Creacion Asistida de Cuentas" en
 * Notion. Prestar o que te presten dinero (en cualquier direccion, formal o
 * informal) tampoco vive aqui -- eso es Deudas (M05), no Accounts: no importa
 * cuanto le prestes a alguien, nunca se convierte en una cuenta mas junto a
 * tu banco. */
const ACCOUNT_KINDS = [
  {
    kind: 'checking' as const,
    label: 'Cuenta bancaria',
    sublabel: 'de débito',
    icon: Landmark,
    type: 'asset' as const,
    subtype: 'checking',
    defaultColor: '#3b82f6',
  },
  {
    kind: 'savings' as const,
    label: 'Cuenta de ahorro',
    sublabel: '',
    icon: PiggyBank,
    type: 'asset' as const,
    subtype: 'savings',
    defaultColor: '#22c55e',
  },
  {
    kind: 'cash' as const,
    label: 'Efectivo',
    sublabel: '',
    icon: Wallet,
    type: 'asset' as const,
    subtype: 'cash',
    defaultColor: '#f59e0b',
  },
  {
    kind: 'credit_card' as const,
    label: 'Tarjeta de',
    sublabel: 'crédito',
    icon: CreditCard,
    type: 'liability' as const,
    subtype: 'credit_card',
    defaultColor: '#ef4444',
  },
]
type AccountKind = (typeof ACCOUNT_KINDS)[number]['kind']

function InfoTip({ text }: { text: string }) {
  return (
    <span title={text} className="text-muted-foreground/60 cursor-help select-none">
      {' '}
      ⓘ
    </span>
  )
}

function Field({ label, tip, children }: { label: string; tip?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted-foreground">
        {label}
        {tip && <InfoTip text={tip} />}
      </label>
      {children}
    </div>
  )
}

function DaySelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Select value={value || null} onValueChange={(v) => onChange(v ?? '')}>
      <SelectTrigger className="h-9 w-full">
        <SelectValue placeholder="Selecciona..." />
      </SelectTrigger>
      <SelectContent>
        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
          <SelectItem key={d} value={String(d)}>
            {d}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function CurrencySelect({ value, onChange }: { value: string; onChange: (value: 'MXN' | 'USD') => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange((v as 'MXN' | 'USD') ?? 'MXN')}>
      <SelectTrigger className="h-9 w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="MXN">MXN</SelectItem>
        <SelectItem value="USD">USD</SelectItem>
      </SelectContent>
    </Select>
  )
}

function LogoField({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) {
  const [error, setError] = useState('')

  async function handleFile(file: File | undefined) {
    if (!file) return
    setError('')
    const validationError = validateImageFile(file)
    if (validationError) {
      setError(validationError)
      return
    }
    try {
      onChange(await fileToNormalizedDataUrl(file))
    } catch {
      setError('No se pudo procesar la imagen.')
    }
  }

  return (
    <Field label="Logo (opcional)" tip="Es tuyo y bajo tu propio criterio — la app no incluye ni redistribuye logos de bancos.">
      <div className="flex items-center gap-3">
        {value ? (
          <img src={value} alt="" className="w-10 h-10 rounded-md object-cover border border-border" />
        ) : (
          <div className="w-10 h-10 rounded-md border border-dashed border-border" />
        )}
        <label className="text-[12px] text-muted-foreground hover:text-foreground cursor-pointer underline underline-offset-2">
          {value ? 'Cambiar' : 'Subir imagen'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              void handleFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[12px] text-muted-foreground hover:text-destructive"
          >
            Quitar
          </button>
        )}
      </div>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </Field>
  )
}

/** 'in'/'out' aqui es de UX (que columna/color usar), no el Debe/Haber
 * contable -- para un pasivo (TDC) van invertidos a proposito. Contablemente
 * un pasivo crece con un credito (increases=true), pero en un estado de
 * cuenta de tarjeta real "Cargo" es una compra (aumenta la deuda) y "Abono"
 * es un pago (la reduce): exactamente al reves de como "aumenta el saldo"
 * se ve en una cuenta de activo. Sin este ajuste, un gasto con la TDC se
 * veia como Abono en verde -- correcto en teoria contable, confuso para
 * cualquiera acostumbrado a un estado de cuenta bancario. El balance real
 * de la cuenta sigue calculandose aparte con la convencion contable de
 * siempre (ver DEBIT_NORMAL_TYPES en account_service.py, backend).*/
function lineDirection(tx: Transaction, accountId: string, accountType: Account['type']) {
  const line = tx.lines.find((l) => l.account_id === accountId)
  if (!line) return null
  const isDebitNormal = accountType === 'asset' || accountType === 'expense'
  const increases = (line.type === 'debit') === isDebitNormal
  if (accountType === 'liability') return increases ? 'out' : 'in'
  return increases ? 'in' : 'out'
}

interface WizardState {
  kind: AccountKind
  name: string
  balance: string
  last4: string
  currency: 'MXN' | 'USD'
  color: string
  logo: string | null
  notes: string
  creditLimit: string
  interestRatePct: string
  billingDay: string
  dueDay: string
}

function defaultWizardState(kind: AccountKind = 'checking'): WizardState {
  const config = ACCOUNT_KINDS.find((k) => k.kind === kind)!
  return {
    kind,
    name: '',
    balance: '0',
    last4: '',
    currency: 'MXN',
    color: config.defaultColor,
    logo: null,
    notes: '',
    creditLimit: '',
    interestRatePct: '',
    billingDay: '',
    dueDay: '',
  }
}

function NewAccountForm({ onDone }: { onDone: () => void }) {
  const createAccount = useCreateAccount()
  const pushToast = useUiStore((s) => s.pushToast)
  const [form, setForm] = useState<WizardState>(defaultWizardState())
  const [showOptional, setShowOptional] = useState(false)

  const config = ACCOUNT_KINDS.find((k) => k.kind === form.kind)!
  const isCreditCard = form.kind === 'credit_card'

  function selectKind(kind: AccountKind) {
    const next = ACCOUNT_KINDS.find((k) => k.kind === kind)!
    setForm((f) => ({ ...f, kind, color: next.defaultColor }))
  }

  const rateNum = parseFloat(form.interestRatePct)
  const rateLooksLikeDecimal = form.interestRatePct !== '' && rateNum > 0 && rateNum < 1
  const sameDay = isCreditCard && form.billingDay !== '' && form.billingDay === form.dueDay
  const balanceInvalid = form.balance !== '' && parseFloat(form.balance) < 0

  const canSubmit =
    form.name.trim() !== '' &&
    !balanceInvalid &&
    (!isCreditCard ||
      (form.creditLimit !== '' &&
        parseFloat(form.creditLimit) > 0 &&
        form.balance !== '' &&
        form.interestRatePct !== '' &&
        parseFloat(form.interestRatePct) > 0 &&
        form.billingDay !== '' &&
        form.dueDay !== ''))

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    const last4 = form.last4.trim()
    const payload: CreateAccountInput = {
      name: form.name.trim(),
      type: config.type,
      subtype: config.subtype,
      last_4_digits: last4.length === 4 ? last4 : null,
      currency: form.currency,
      color: form.color,
      logo_data_url: form.logo,
      notes: form.notes.trim() || null,
      initial_balance: form.balance || '0',
      credit_limit: isCreditCard ? form.creditLimit : null,
      interest_rate: isCreditCard ? String(parseFloat(form.interestRatePct) / 100) : null,
      billing_cycle_day: isCreditCard ? Number(form.billingDay) : null,
      payment_due_day: isCreditCard ? Number(form.dueDay) : null,
    }
    try {
      await createAccount.mutateAsync(payload)
      pushToast(`Cuenta "${payload.name}" agregada`, 'success')
      onDone()
    } catch {
      // error mostrado abajo
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">¿Qué tipo de cuenta?</label>
        <div className="grid grid-cols-2 gap-2">
          {ACCOUNT_KINDS.map(({ kind, label, sublabel, icon: Icon }) => {
            const selected = form.kind === kind
            return (
              <button
                key={kind}
                type="button"
                onClick={() => selectKind(kind)}
                className={`flex flex-col items-center justify-center gap-1.5 rounded-md border py-3 px-2 text-center transition-colors ${selected ? '' : 'border-border text-muted-foreground hover:text-foreground'}`}
                style={selected ? { borderColor: 'var(--nl-accent)', background: 'var(--nl-bg-hover)' } : undefined}
              >
                <Icon size={18} />
                <span className="text-[12px] leading-tight">
                  {label}
                  {sublabel && (
                    <>
                      <br />
                      {sublabel}
                    </>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <Field label="Nombre">
        <input
          required
          placeholder={isCreditCard ? 'Ej: Stori Mastercard' : 'Ej: BBVA Nómina'}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </Field>

      {isCreditCard ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Límite de crédito">
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={form.creditLimit}
                onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
                className={`${selectClass} h-9 w-full`}
              />
            </Field>
            <Field
              label="¿Cuánto debes hoy?"
              tip="Lo que debes hoy en esta tarjeta, no el límite. Si no sabes exacto, pon un aproximado."
            >
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={form.balance}
                onChange={(e) => setForm({ ...form, balance: e.target.value })}
                className={`${selectClass} h-9 w-full`}
              />
            </Field>
          </div>
          <Field
            label="Tasa de interés anual (%)"
            tip="El CAT o tasa anual que cobra tu banco. Lo encuentras en tu contrato o app. Ej: 47.5"
          >
            <input
              type="number"
              step="0.01"
              min="0"
              required
              placeholder="Ej: 47.5"
              value={form.interestRatePct}
              onChange={(e) => setForm({ ...form, interestRatePct: e.target.value })}
              className={`${selectClass} h-9 w-full`}
            />
            {form.interestRatePct !== '' && !rateLooksLikeDecimal && (
              <p className="text-[11px] text-muted-foreground">= {form.interestRatePct}% anual</p>
            )}
            {rateLooksLikeDecimal && (
              <p className="text-[11px] text-warning">¿Quisiste decir {rateNum * 100}%?</p>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="¿Qué día te cortan?"
              tip="El día del mes en que tu banco genera tu estado de cuenta. Ej: si es el 27, escribe 27."
            >
              <DaySelect value={form.billingDay} onChange={(v) => setForm({ ...form, billingDay: v })} />
            </Field>
            <Field
              label="¿Día límite para pagar?"
              tip="El día del mes en que vence tu pago para no generar intereses moratorios."
            >
              <DaySelect value={form.dueDay} onChange={(v) => setForm({ ...form, dueDay: v })} />
            </Field>
          </div>
          {sameDay && (
            <p className="text-[11px] text-warning">
              El día de corte y el día límite de pago son el mismo — revisa que sea correcto.
            </p>
          )}
        </>
      ) : (
        <Field label="¿Cuánto tienes hoy?">
          <input
            type="number"
            step="0.01"
            min="0"
            required
            value={form.balance}
            onChange={(e) => setForm({ ...form, balance: e.target.value })}
            className={`${selectClass} h-9 w-full`}
          />
        </Field>
      )}
      {balanceInvalid && <p className="text-[11px] text-destructive">El saldo no puede ser negativo.</p>}

      <button
        type="button"
        onClick={() => setShowOptional((v) => !v)}
        className="text-[12px] text-muted-foreground hover:text-foreground text-left"
      >
        {showOptional ? '− Menos detalles' : '+ Más detalles (opcional)'}
      </button>

      {showOptional && (
        <div className="flex flex-col gap-3 rounded-md border border-dashed border-border p-3">
          {form.kind !== 'cash' && (
            <Field label="Últimos 4 dígitos">
              <input
                maxLength={4}
                inputMode="numeric"
                value={form.last4}
                onChange={(e) => setForm({ ...form, last4: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                className={`${selectClass} h-9 w-full`}
              />
            </Field>
          )}
          <LogoField value={form.logo} onChange={(v) => setForm({ ...form, logo: v })} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Moneda">
              <CurrencySelect value={form.currency} onChange={(v) => setForm({ ...form, currency: v })} />
            </Field>
            <Field label="Color">
              <input
                type="color"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-transparent px-1"
              />
            </Field>
          </div>
          <Field label="Notas">
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className={`${selectClass} w-full py-2 resize-none`}
            />
          </Field>
        </div>
      )}

      {createAccount.isError && <p className="text-sm text-destructive">{apiErrorMessage(createAccount.error)}</p>}
      <DialogPrimaryButton pending={createAccount.isPending} disabled={!canSubmit}>
        Crear cuenta
      </DialogPrimaryButton>
    </form>
  )
}

function EditAccountForm({ account, onDone }: { account: Account; onDone: () => void }) {
  const updateAccount = useUpdateAccount()
  const pushToast = useUiStore((s) => s.pushToast)
  const confirm = useConfirmStore((s) => s.ask)
  const isCreditCard = account.subtype === 'credit_card'
  // Consulta barata (per_page:1, solo nos importa meta.total) para saber si
  // ya hay movimientos antes de advertir sobre el saldo inicial.
  const { data: txCheck } = useTransactions({ account_id: account.id, per_page: 1 })
  const hasTransactions = (txCheck?.meta.total ?? 0) > 0

  const [form, setForm] = useState({
    name: account.name,
    last4: account.last_4_digits ?? '',
    currency: account.currency,
    color: account.color,
    logo: account.logo_data_url,
    notes: account.notes ?? '',
    initialBalance: account.initial_balance,
    creditLimit: account.credit_limit ?? '',
    interestRatePct: account.interest_rate ? String(Number(account.interest_rate) * 100) : '',
    billingDay: account.billing_cycle_day != null ? String(account.billing_cycle_day) : '',
    dueDay: account.payment_due_day != null ? String(account.payment_due_day) : '',
  })

  const initialBalanceChanged = Number(form.initialBalance) !== Number(account.initial_balance)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    if (initialBalanceChanged && hasTransactions) {
      const newBalance =
        Number(account.balance) + (Number(form.initialBalance) - Number(account.initial_balance))
      const ok = await confirm({
        title: 'Cambiar saldo inicial',
        message:
          `Esta cuenta ya tiene transacciones registradas. Cambiar el saldo inicial de ` +
          `${formatMoney(account.initial_balance)} a ${formatMoney(form.initialBalance)} recalculará ` +
          `el saldo actual de ${formatMoney(account.balance)} a ${formatMoney(String(newBalance))} ` +
          `-- ninguna transacción existente se modifica. ¿Continuar?`,
        confirmLabel: 'Cambiar saldo inicial',
        variant: 'danger',
      })
      if (!ok) return
    }

    const last4 = form.last4.trim()
    const payload: UpdateAccountInput = {
      name: form.name.trim(),
      last_4_digits: last4.length === 4 ? last4 : null,
      currency: form.currency,
      color: form.color,
      logo_data_url: form.logo,
      notes: form.notes.trim() || null,
      initial_balance: form.initialBalance,
      ...(isCreditCard
        ? {
            credit_limit: form.creditLimit || null,
            interest_rate: form.interestRatePct ? String(parseFloat(form.interestRatePct) / 100) : null,
            billing_cycle_day: form.billingDay ? Number(form.billingDay) : null,
            payment_due_day: form.dueDay ? Number(form.dueDay) : null,
          }
        : {}),
    }
    try {
      await updateAccount.mutateAsync({ id: account.id, input: payload })
      pushToast(`Cuenta "${payload.name}" actualizada`, 'success')
      onDone()
    } catch {
      // error mostrado abajo
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Field label="Nombre">
        <input
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </Field>

      <Field
        label="Saldo inicial"
        tip="El saldo con el que arrancó esta cuenta. Cambiarlo no toca ninguna transacción, solo desplaza el saldo actual por la misma diferencia."
      >
        <input
          type="number"
          step="0.01"
          value={form.initialBalance}
          onChange={(e) => setForm({ ...form, initialBalance: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
        {hasTransactions && (
          <p className="text-xs mt-1" style={{ color: 'var(--nl-warning-ink)' }}>
            Esta cuenta ya tiene transacciones. Cambiar este valor recalculará el saldo actual (te
            pediremos confirmar antes de guardar).
          </p>
        )}
      </Field>

      {isCreditCard && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Límite de crédito">
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.creditLimit}
                onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
                className={`${selectClass} h-9 w-full`}
              />
            </Field>
            <Field
              label="Tasa de interés anual (%)"
              tip="El CAT o tasa anual que cobra tu banco. Ej: 47.5"
            >
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.interestRatePct}
                onChange={(e) => setForm({ ...form, interestRatePct: e.target.value })}
                className={`${selectClass} h-9 w-full`}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="¿Qué día te cortan?">
              <DaySelect value={form.billingDay} onChange={(v) => setForm({ ...form, billingDay: v })} />
            </Field>
            <Field label="¿Día límite para pagar?">
              <DaySelect value={form.dueDay} onChange={(v) => setForm({ ...form, dueDay: v })} />
            </Field>
          </div>
        </>
      )}

      {account.subtype !== 'cash' && (
        <Field label="Últimos 4 dígitos">
          <input
            maxLength={4}
            inputMode="numeric"
            value={form.last4}
            onChange={(e) => setForm({ ...form, last4: e.target.value.replace(/\D/g, '').slice(0, 4) })}
            className={`${selectClass} h-9 w-full`}
          />
        </Field>
      )}
      <LogoField value={form.logo} onChange={(v) => setForm({ ...form, logo: v })} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Moneda">
          <CurrencySelect value={form.currency} onChange={(v) => setForm({ ...form, currency: v })} />
        </Field>
        <Field label="Color">
          <input
            type="color"
            value={form.color}
            onChange={(e) => setForm({ ...form, color: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-transparent px-1"
          />
        </Field>
      </div>
      <Field label="Notas">
        <textarea
          rows={2}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className={`${selectClass} w-full py-2 resize-none`}
        />
      </Field>

      {updateAccount.isError && <p className="text-sm text-destructive">{apiErrorMessage(updateAccount.error)}</p>}
      <DialogPrimaryButton icon={Check} pending={updateAccount.isPending}>
        Guardar cambios
      </DialogPrimaryButton>
    </form>
  )
}

function ReconcileAccountForm({ account, onDone }: { account: Account; onDone: () => void }) {
  const reconcile = useReconcileAccount()
  const pushToast = useUiStore((s) => s.pushToast)
  const [realBalance, setRealBalance] = useState(account.balance)
  const [notes, setNotes] = useState('')

  const delta = realBalance === '' ? 0 : Number(realBalance) - Number(account.balance)
  // Umbral chico en vez de === 0 exacto: evita que un redondeo de centavos en
  // el input (ej. el usuario borra y vuelve a escribir "1105.00") dispare un
  // ajuste de $0.00 real que solo ensucia el historial.
  const hasDelta = Math.abs(delta) >= 0.01

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      const result = await reconcile.mutateAsync({
        id: account.id,
        input: { real_balance: realBalance, notes: notes.trim() || undefined },
      })
      if (result.adjusted) {
        const kind = Number(result.delta) > 0 ? 'Entrada' : 'Salida'
        pushToast(`${kind} de ajuste registrada: ${formatMoney(String(Math.abs(Number(result.delta))))}`, 'success')
      }
      onDone()
    } catch {
      // error mostrado abajo
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <p className="text-[12px] text-muted-foreground">
        Cuenta actual: <strong>{formatMoney(account.balance)}</strong>. Escribe lo que de verdad tienes
        (contado o del estado de cuenta) y el resto se ajusta solo.
      </p>
      <Field label="Saldo real">
        <input
          type="number"
          step="0.01"
          required
          value={realBalance}
          onChange={(e) => setRealBalance(e.target.value)}
          className={`${selectClass} h-9 w-full`}
        />
      </Field>
      <Field label="Nota (opcional)" tip="Con el tiempo estas notas te dicen qué es lo que no estás registrando.">
        <textarea
          rows={2}
          placeholder="ej. conté mi cartera y tenía menos, seguro fueron los tacos del viernes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={`${selectClass} w-full py-2 resize-none`}
        />
      </Field>

      {hasDelta ? (
        <p
          className="text-[12.5px] rounded-md px-3 py-2"
          style={{
            background: delta > 0 ? 'var(--nl-accent-soft-bg)' : 'var(--nl-danger-soft-bg)',
            color: delta > 0 ? 'var(--nl-accent-ink)' : 'var(--nl-danger-ink)',
          }}
        >
          Esto va a crear una {delta > 0 ? 'entrada' : 'salida'} de ajuste de{' '}
          <strong>{formatMoney(String(Math.abs(delta)))}</strong>.
        </p>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">Tu saldo ya coincide, no hace falta ajustar.</p>
      )}

      {reconcile.isError && <p className="text-sm text-destructive">{apiErrorMessage(reconcile.error)}</p>}
      <DialogPrimaryButton pending={reconcile.isPending} pendingLabel="Conciliando..." disabled={!hasDelta}>
        Conciliar saldo
      </DialogPrimaryButton>
    </form>
  )
}

function TdcCycleCard({ accountId }: { accountId: string }) {
  const { data: cycle, isLoading } = useTdcCycle(accountId, true)
  if (isLoading || !cycle) return null

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 rounded-md border border-border bg-card p-3.5">
      <div>
        <div className="text-[10px] tracking-wider text-muted-foreground">DÍA DE CORTE</div>
        <div className="text-[15px] font-medium">{cycle.billing_cycle_day ?? '—'}</div>
      </div>
      <div>
        <div className="text-[10px] tracking-wider text-muted-foreground">LÍMITE DE PAGO</div>
        <div className="text-[15px] font-medium">
          {cycle.payment_due_day ?? '—'}
          {cycle.days_until_due != null && (
            <span className="text-[11px] text-muted-foreground ml-1">({cycle.days_until_due}d)</span>
          )}
        </div>
      </div>
      <div>
        <div className="text-[10px] tracking-wider text-muted-foreground">SALDO DEL CICLO</div>
        <div className="text-[15px] font-medium">{formatMoney(cycle.current_cycle_balance)}</div>
      </div>
      <div>
        <div className="text-[10px] tracking-wider text-muted-foreground">CRÉDITO DISPONIBLE</div>
        <div className="text-[15px] font-medium" style={{ color: 'var(--nl-accent-ink)' }}>
          {cycle.available_credit != null ? formatMoney(cycle.available_credit) : '—'}
        </div>
      </div>
    </div>
  )
}

function AccountRow({
  account,
  selected,
  onSelect,
  history,
}: {
  account: Account
  selected: boolean
  onSelect: () => void
  history?: number[]
}) {
  return (
    <div
      onClick={onSelect}
      className="flex items-center gap-2.5 px-2 py-2.5 rounded-md cursor-pointer transition-colors"
      style={{ background: selected ? 'var(--nl-bg-hover)' : 'transparent' }}
    >
      {account.logo_data_url ? (
        <img
          src={account.logo_data_url}
          alt=""
          className="w-6 h-6 rounded-md object-cover flex-shrink-0 border border-border"
        />
      ) : (
        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: account.color }} />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium truncate">{account.name}</div>
        <div className="text-[11px] text-muted-foreground truncate">
          {accountSubtypeLabel(account.subtype) || account.type}
        </div>
      </div>
      {history && history.length > 1 && <Sparkline series={history} />}
      <div className="text-[13px] font-medium" style={{ color: amountColor(account.balance) }}>
        {formatMoney(account.balance)}
      </div>
    </div>
  )
}

function AccountsHelp() {
  return (
    <>
      <HelpSection heading="Qué es esta pantalla">
        <p>
          Tus cuentas reales: bancos, efectivo y tarjetas de crédito. El resumen de arriba (Activos,
          Pasivos, Patrimonio neto) se calcula sumando el saldo de todas ellas.
        </p>
      </HelpSection>
      <HelpSection heading="Tipos de cuenta">
        <p>
          Al crear una cuenta eliges entre <strong>bancaria</strong>, <strong>ahorro</strong>,{' '}
          <strong>efectivo</strong> y <strong>tarjeta de crédito</strong>. Las primeras tres son dinero
          tuyo disponible; la tarjeta es una deuda (pasivo).
        </p>
      </HelpSection>
      <HelpSection heading="Tarjetas de crédito">
        <p>
          Además del nombre y saldo, una TDC guarda límite de crédito, tasa de interés, día de corte y día
          límite de pago — esos dos últimos alimentan el ciclo de facturación que ves en el detalle de la
          cuenta.
        </p>
      </HelpSection>
      <HelpSection heading="Logo y personalización">
        <p>
          Puedes subir una foto/logo para identificar la cuenta de un vistazo (se recorta y ajusta sola a
          un cuadrado) y elegir un color que se usa en gráficas y listas en toda la app.
        </p>
      </HelpSection>
      <HelpSection heading="Movimientos de la cuenta">
        <p>
          Al seleccionar una cuenta a la izquierda, ves su historial de movimientos a la derecha, con
          filtro de Entradas/Salidas y buscador.
        </p>
      </HelpSection>
      <HelpSection heading="Conciliar saldo">
        <p>
          Disponible en cuentas bancarias/de ahorro. Escribes lo que de verdad tienes (contado o del
          estado de cuenta) y la app registra una transacción de ajuste por la diferencia — a diferencia
          de editar el "Saldo inicial", esto sí queda como un movimiento visible en tu historial.
        </p>
      </HelpSection>
      <HelpTip>
        Prestarle dinero a alguien o que te presten no crea una cuenta aquí — vive en Deudas, separado de
        tus cuentas reales, sin importar cuántas personas involucre.
      </HelpTip>
    </>
  )
}

export function Accounts() {
  const { data: summary } = useAccountSummary()
  const { data: accounts, isLoading } = useAccounts()
  const [open, setOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [reconcilingAccount, setReconcilingAccount] = useState<Account | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [segment, setSegment] = useState<Segment>('ALL')
  const pushToast = useUiStore((s) => s.pushToast)
  const confirm = useConfirmStore((s) => s.ask)
  const deleteAccount = useDeleteAccount()
  const openDetailed = useTransactionModalStore((s) => s.openDetailed)

  const assetAccounts = accounts?.filter((a) => a.type === 'asset') ?? []
  const liabilityAccounts = accounts?.filter((a) => a.type === 'liability') ?? []
  const selectedAccount =
    accounts?.find((a) => a.id === selectedAccountId) ?? assetAccounts[0] ?? liabilityAccounts[0]

  const { data: ledger, isLoading: loadingLedger } = useTransactions({
    account_id: selectedAccount?.id,
    per_page: 50,
  })
  const { data: allCategories } = useCategories()
  const categoryColorById = new Map((allCategories ?? []).map((c) => [c.id, c.color]))

  const LEDGER_PREVIEW_LIMIT = 8
  const filteredRows = (ledger?.data ?? []).filter((tx) => {
    if (!selectedAccount) return false
    if (segment !== 'ALL') {
      const dir = lineDirection(tx, selectedAccount.id, selectedAccount.type)
      if (segment === 'IN' && dir !== 'in') return false
      if (segment === 'OUT' && dir !== 'out') return false
    }
    if (search && !tx.description.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })
  const visibleRows = filteredRows.slice(0, LEDGER_PREVIEW_LIMIT)
  const hasMoreInAccount = (ledger?.meta?.total ?? 0) > LEDGER_PREVIEW_LIMIT

  async function handleDeleteAccount(account: Account) {
    const ok = await confirm({
      title: 'Eliminar cuenta',
      message: `¿Eliminar la cuenta "${account.name}"? Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await deleteAccount.mutateAsync(account.id)
      if (selectedAccountId === account.id) setSelectedAccountId(null)
    } catch (error) {
      pushToast(apiErrorMessage(error), 'error')
    }
  }

  return (
    <div>
      <ViewHeader
        icon={<Building2 />}
        title="Cuentas"
        help={<AccountsHelp />}
        section={HEADER_SECTIONS.diario}
        tourKey="accounts"
      />

      {/* items-stretch (default de grid, explicito aqui para que quede claro
          por que) -- con items-start las dos columnas terminaban a alturas
          distintas segun cuanto contenido tuviera cada una (se veia parejo
          solo por casualidad), dejando un borde inferior irregular entre
          ambas tarjetas. Ahora siempre miden lo mismo, y en la de la
          izquierda "Patrimonio neto" + "Agregar cuenta" quedan pegados
          abajo (mt-auto) en vez de flotar justo despues de la lista. */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 items-stretch">
        <div className="bg-card border border-border rounded-md p-[18px] flex flex-col" data-tour="accounts:list">
          <div className="text-[11px] tracking-wider text-muted-foreground mb-2">ACTIVOS</div>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : (
            <div className="flex flex-col gap-1">
              {assetAccounts.map((a) => (
                <AccountRow
                  key={a.id}
                  account={a}
                  selected={selectedAccount?.id === a.id}
                  onSelect={() => setSelectedAccountId(a.id)}
                />
              ))}
            </div>
          )}
          <div className="text-[11px] tracking-wider text-muted-foreground mt-4 mb-2">PASIVOS</div>
          <div className="flex flex-col gap-1">
            {liabilityAccounts.map((a) => (
              <AccountRow
                key={a.id}
                account={a}
                selected={selectedAccount?.id === a.id}
                onSelect={() => setSelectedAccountId(a.id)}
              />
            ))}
          </div>

          <div className="flex items-center justify-between mt-auto pt-3.5 border-t border-border">
            <div>
              <div className="text-[10px] tracking-wider text-muted-foreground">PATRIMONIO NETO</div>
              <div className="text-xl font-light" style={{ color: amountColor(summary?.net_worth ?? '0') }}>
                {formatMoney(summary?.net_worth ?? '0')}
              </div>
            </div>
            <Dialog
              open={open}
              onOpenChange={(next, eventDetails) => {
                // Clic afuera del modal (p.ej. al usar el color picker nativo)
                // no debe cerrarlo -- solo Escape o los botones explicitos.
                if (!next && eventDetails.reason === 'outside-press') return
                setOpen(next)
              }}
            >
              <DialogTrigger
                render={
                  <button
                    type="button"
                    data-tour="accounts:new-button"
                    className="flex items-center gap-1.5 rounded px-3 py-1.5 text-[12px] border border-border text-muted-foreground hover:text-foreground"
                  >
                    <Plus size={13} />
                    Agregar cuenta
                  </button>
                }
              />
              <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Nueva cuenta</DialogTitle>
                </DialogHeader>
                <NewAccountForm onDone={() => setOpen(false)} />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="bg-card border border-border rounded-md p-5 min-w-0" data-tour="accounts:detail">
          {selectedAccount ? (
            <>
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="text-[16px] font-medium">
                  {selectedAccount.name} ·{' '}
                  <span style={{ color: amountColor(selectedAccount.balance) }}>
                    {formatMoney(selectedAccount.balance)}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Dialog
                    open={editingAccount?.id === selectedAccount.id}
                    onOpenChange={(next, eventDetails) => {
                      if (!next && eventDetails.reason === 'outside-press') return
                      setEditingAccount(next ? selectedAccount : null)
                    }}
                  >
                    <DialogTrigger
                      render={
                        <button
                          type="button"
                          className="flex items-center gap-1.5 rounded px-3 py-1.5 text-[12px] border border-border text-muted-foreground hover:text-info"
                        >
                          <Pencil size={13} />
                          Editar
                        </button>
                      }
                    />
                    <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Editar cuenta</DialogTitle>
                      </DialogHeader>
                      <EditAccountForm account={selectedAccount} onDone={() => setEditingAccount(null)} />
                    </DialogContent>
                  </Dialog>
                  {selectedAccount.type === 'asset' &&
                    RECONCILABLE_SUBTYPES.has(selectedAccount.subtype ?? '') && (
                      <Dialog
                        open={reconcilingAccount?.id === selectedAccount.id}
                        onOpenChange={(next, eventDetails) => {
                          if (!next && eventDetails.reason === 'outside-press') return
                          setReconcilingAccount(next ? selectedAccount : null)
                        }}
                      >
                        <DialogTrigger
                          render={
                            <button
                              type="button"
                              className="flex items-center gap-1.5 rounded px-3 py-1.5 text-[12px] border border-border text-muted-foreground hover:text-foreground"
                            >
                              <Scale size={13} />
                              Conciliar saldo
                            </button>
                          }
                        />
                        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>Conciliar saldo</DialogTitle>
                          </DialogHeader>
                          <ReconcileAccountForm
                            account={selectedAccount}
                            onDone={() => setReconcilingAccount(null)}
                          />
                        </DialogContent>
                      </Dialog>
                    )}
                  <button
                    type="button"
                    onClick={() => handleDeleteAccount(selectedAccount)}
                    className="flex items-center gap-1.5 rounded px-3 py-1.5 text-[12px] border border-border text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 size={13} />
                    Eliminar
                  </button>
                  <button
                    type="button"
                    onClick={() => openDetailed(selectedAccount.id)}
                    className="flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[13px] font-medium"
                    style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
                  >
                    <Plus size={14} />
                    Nueva transacción
                  </button>
                </div>
              </div>

              {selectedAccount.last_4_digits && (
                <div className="text-[12px] text-muted-foreground mb-4">
                  •••• {selectedAccount.last_4_digits}
                </div>
              )}

              {selectedAccount.subtype === 'credit_card' && selectedAccount.billing_cycle_day != null && (
                <TdcCycleCard accountId={selectedAccount.id} />
              )}

              <div className="flex gap-2 mb-4 flex-wrap">
                <input
                  placeholder="Buscar transacciones"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={`${selectClass} h-9 flex-1 min-w-[160px]`}
                />
                <SegmentedControl
                  value={segment}
                  onChange={setSegment}
                  options={[
                    { value: 'ALL', label: 'TODO' },
                    { value: 'IN', label: 'ENTRADA' },
                    { value: 'OUT', label: 'SALIDA' },
                  ]}
                />
              </div>

              {loadingLedger ? (
                <p className="text-sm text-muted-foreground">Cargando...</p>
              ) : filteredRows.length === 0 ? (
                <p className="text-center text-[12px] text-muted-foreground py-7">
                  Ninguna transacción coincide con tus filtros.
                </p>
              ) : (
                <div className="rounded-md overflow-hidden border border-border">
                  <div className="hidden lg:grid grid-cols-[90px_2fr_1fr_90px_90px] gap-2 px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <span>Fecha</span>
                    <span>Descripción</span>
                    <span>Categoría</span>
                    <span className="text-right">Cargo</span>
                    <span className="text-right">Abono</span>
                  </div>
                  {visibleRows.map((tx) => {
                    const dir = lineDirection(tx, selectedAccount.id, selectedAccount.type)
                    const categoryBadge = (
                      <CategoryBadge
                        name={tx.category_name ?? entryTypeLabel(tx.entry_type)}
                        color={tx.category_id ? categoryColorById.get(tx.category_id) : undefined}
                      />
                    )
                    return (
                      <div key={tx.id}>
                        <div className="hidden lg:grid grid-cols-[90px_2fr_1fr_90px_90px] gap-2 px-3 py-2.5 text-[13px] border-t border-border items-center">
                          <span className="text-muted-foreground">{tx.date}</span>
                          <span className="truncate">{tx.description}</span>
                          <span>{categoryBadge}</span>
                          <span className="text-right" style={{ color: 'var(--nl-danger-ink)' }}>
                            {dir === 'out' ? formatMoney(tx.amount ?? '0') : ''}
                          </span>
                          <span className="text-right" style={{ color: 'var(--nl-accent-ink)' }}>
                            {dir === 'in' ? formatMoney(tx.amount ?? '0') : ''}
                          </span>
                        </div>
                        <div className="lg:hidden flex flex-col gap-1.5 px-3 py-2.5 text-[13px] border-t border-border">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate">{tx.description}</span>
                            <span
                              className="flex-shrink-0"
                              style={{ color: dir === 'out' ? 'var(--nl-danger-ink)' : 'var(--nl-accent-ink)' }}
                            >
                              {dir === 'out' ? '-' : '+'}
                              {formatMoney(tx.amount ?? '0')}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            {categoryBadge}
                            <span className="text-muted-foreground text-[12px] flex-shrink-0">{tx.date}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="flex justify-between items-center mt-3.5 text-xs text-muted-foreground">
                <div>
                  Mostrando {visibleRows.length} de {filteredRows.length}
                </div>
                {hasMoreInAccount && (
                  <Link
                    to={`/transactions?account=${selectedAccount.id}`}
                    className="text-[color:var(--nl-accent-ink)] hover:underline"
                  >
                    Ver todas en Transacciones →
                  </Link>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Crea una cuenta para ver su historial aquí.</p>
          )}
        </div>
      </div>
    </div>
  )
}
