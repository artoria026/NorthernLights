import { type FormEvent, useEffect, useState } from 'react'
import { DialogCancelButton, DialogFooter, DialogPrimaryButton, SubmitShortcutHint } from '@/components/nl/DialogActions'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CategorySelect } from '@/components/nl/CategorySelect'
import { SegmentedControl } from '@/components/nl/primitives'
import { useAccounts } from '@/hooks/useAccounts'
import { useCategories } from '@/hooks/useCategories'
import { useCreateTransaction } from '@/hooks/useTransactions'
import { apiErrorMessage } from '@/services/api'
import { selectClass } from '@/lib/utils'
import { useTransactionModalStore } from '@/stores/transactionModalStore'
import type { Category, EntryType } from '@/types'

type SimpleType = 'expense' | 'income'
type DetailedType = 'expense' | 'income' | 'transfer'

interface FormState {
  type: DetailedType
  amount: string
  desc: string
  categoryId: string
  accountId: string
  contraAccountId: string
  date: string
  status: 'confirmed' | 'draft'
  notes: string
  isMsi: boolean
  installmentTotal: string
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function defaultForm(accountId?: string): FormState {
  return {
    type: 'expense',
    amount: '',
    desc: '',
    categoryId: '',
    accountId: accountId ?? '',
    contraAccountId: '',
    date: todayIso(),
    status: 'confirmed',
    notes: '',
    isMsi: false,
    installmentTotal: '',
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

export function TransactionModals() {
  const modal = useTransactionModalStore((s) => s.modal)
  const defaultAccountId = useTransactionModalStore((s) => s.defaultAccountId)
  const close = useTransactionModalStore((s) => s.close)
  const switchToDetailed = useTransactionModalStore((s) => s.switchToDetailed)

  const { data: accounts } = useAccounts()
  const createTransaction = useCreateTransaction()
  const [form, setForm] = useState<FormState>(() => defaultForm(defaultAccountId))

  const { data: categories } = useCategories(form.type === 'income' ? 'income' : 'expense')

  useEffect(() => {
    if (modal) setForm(defaultForm(defaultAccountId))
  }, [modal, defaultAccountId])

  const payingAccounts = accounts?.filter((a) => a.type === 'asset' || a.type === 'liability') ?? []
  const amountValid = parseFloat(form.amount) > 0
  const missingCategory = form.type !== 'transfer' && !form.categoryId
  const missingDestination = form.type === 'transfer' && !form.contraAccountId
  const invalidInstallments = form.isMsi && !(parseInt(form.installmentTotal, 10) >= 2)
  const canSubmit =
    amountValid && !!form.accountId && !missingCategory && !missingDestination && !invalidInstallments

  function setType(type: DetailedType) {
    setForm((f) => ({ ...f, type, contraAccountId: '', isMsi: false, installmentTotal: '' }))
  }

  async function submit() {
    if (!canSubmit) return
    try {
      if (form.type === 'transfer') {
        // Transfer: two real user accounts, no category or internal
        // account involved.
        await createTransaction.mutateAsync({
          date: form.date,
          description: form.desc || 'Transferencia',
          notes: form.notes || undefined,
          entry_type: 'transfer',
          category_id: null,
          lines: [
            { account_id: form.contraAccountId, amount: form.amount, type: 'debit' },
            { account_id: form.accountId, amount: form.amount, type: 'credit' },
          ],
        })
      } else {
        // Expense/income: the backend resolves the category's internal
        // ledger account on its own, the frontend never sees or picks it.
        const entryType: EntryType = form.type
        await createTransaction.mutateAsync({
          date: form.date,
          description: form.desc || (form.type === 'expense' ? 'Gasto' : 'Ingreso'),
          notes: form.notes || undefined,
          entry_type: entryType,
          category_id: form.categoryId,
          account_id: form.accountId,
          amount: form.amount,
          installment_total:
            form.type === 'expense' && form.isMsi ? parseInt(form.installmentTotal, 10) : undefined,
        })
      }
      close()
    } catch {
      // error shown below
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void submit()
  }

  const open = modal !== null

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      {modal === 'quick' && (
        <DialogContent className="sm:max-w-md p-6" showCloseButton>
          <DialogHeader>
            <DialogTitle>Agregar rápido</DialogTitle>
          </DialogHeader>
          <QuickForm
            form={form}
            setForm={setForm}
            setType={setType}
            categories={categories}
            payingAccounts={payingAccounts}
            canSubmit={canSubmit}
            isPending={createTransaction.isPending}
            isError={createTransaction.isError}
            error={createTransaction.error}
            onSubmit={handleSubmit}
            onSwitchToDetailed={switchToDetailed}
          />
        </DialogContent>
      )}

      {modal === 'detailed' && (
        <DialogContent className="sm:max-w-lg p-6" showCloseButton>
          <DialogHeader>
            <DialogTitle>Nueva transacción</DialogTitle>
          </DialogHeader>
          <DetailedForm
            form={form}
            setForm={setForm}
            setType={setType}
            categories={categories}
            payingAccounts={payingAccounts}
            canSubmit={canSubmit}
            isPending={createTransaction.isPending}
            isError={createTransaction.isError}
            error={createTransaction.error}
            onSubmit={handleSubmit}
            onClose={close}
          />
        </DialogContent>
      )}
    </Dialog>
  )
}

interface SharedFormProps {
  form: FormState
  setForm: React.Dispatch<React.SetStateAction<FormState>>
  setType: (type: DetailedType) => void
  categories: Category[] | undefined
  payingAccounts: { id: string; name: string; type: string; subtype: string | null }[]
  canSubmit: boolean
  isPending: boolean
  isError: boolean
  error: unknown
  onSubmit: (event: FormEvent) => void
}

function QuickForm({
  form,
  setForm,
  setType,
  categories,
  payingAccounts,
  canSubmit,
  isPending,
  isError,
  error,
  onSubmit,
  onSwitchToDetailed,
}: SharedFormProps & { onSwitchToDetailed: () => void }) {
  const simpleType: SimpleType = form.type === 'income' ? 'income' : 'expense'
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <SegmentedControl
        value={simpleType}
        onChange={(v: SimpleType) => setType(v)}
        options={[
          { value: 'expense', label: 'Gasto' },
          { value: 'income', label: 'Ingreso' },
        ]}
        className="w-full [&>button]:flex-1"
      />
      <input
        type="number"
        step="0.01"
        placeholder="$0.00"
        value={form.amount}
        onChange={(e) => setForm({ ...form, amount: e.target.value })}
        className="text-[22px] font-light bg-transparent border-b border-border outline-none py-1 focus:border-ring"
      />
      <input
        placeholder="Descripción"
        value={form.desc}
        onChange={(e) => setForm({ ...form, desc: e.target.value })}
        className={`${selectClass} h-9`}
      />
      <div className="flex gap-2">
        <CategorySelect
          categories={categories}
          value={form.categoryId}
          onValueChange={(v) => setForm({ ...form, categoryId: v })}
          placeholder="Categoría"
          triggerClassName="flex-1 h-9"
        />
        <Select value={form.accountId || null} onValueChange={(v) => setForm({ ...form, accountId: v ?? '' })}>
          <SelectTrigger className="flex-1 h-9">
            <SelectValue placeholder="Cuenta">
              {(v: string | null) => payingAccounts.find((a) => a.id === v)?.name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {payingAccounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {isError && <p className="text-xs text-destructive">{apiErrorMessage(error)}</p>}
      {/* "Detallar" already occupies its usual spot on the far left -- the
          hint is grouped next to the button on the right instead of
          competing for the same space as that link. */}
      <div className="flex items-center justify-between pt-1">
        <button type="button" onClick={onSwitchToDetailed} className="text-xs text-muted-foreground hover:text-foreground">
          Detallar →
        </button>
        <div className="flex items-center gap-3">
          <SubmitShortcutHint />
          <DialogPrimaryButton pending={isPending} disabled={!canSubmit}>
            Guardar
          </DialogPrimaryButton>
        </div>
      </div>
    </form>
  )
}

function DetailedForm({
  form,
  setForm,
  setType,
  categories,
  payingAccounts,
  canSubmit,
  isPending,
  isError,
  error,
  onSubmit,
  onClose,
}: SharedFormProps & { onClose: () => void }) {
  const selectedAccount = payingAccounts.find((a) => a.id === form.accountId)
  const canBeMsi = form.type === 'expense' && selectedAccount?.type === 'liability' && selectedAccount?.subtype === 'credit_card'

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <SegmentedControl
        value={form.type}
        onChange={(v: DetailedType) => setType(v)}
        options={[
          { value: 'expense', label: 'Gasto' },
          { value: 'income', label: 'Ingreso' },
          { value: 'transfer', label: 'Transferencia' },
        ]}
        className="w-full [&>button]:flex-1"
      />
      <input
        type="number"
        step="0.01"
        placeholder="$0.00"
        value={form.amount}
        onChange={(e) => setForm({ ...form, amount: e.target.value })}
        className="text-xl font-light bg-transparent border-b border-border outline-none py-1 focus:border-ring"
      />
      <input
        placeholder="Ej. Cena con amigos"
        value={form.desc}
        onChange={(e) => setForm({ ...form, desc: e.target.value })}
        className={`${selectClass} h-9`}
      />
      <div className="grid grid-cols-2 gap-3">
        {form.type !== 'transfer' ? (
          <Field label="Categoría">
            <CategorySelect
              categories={categories}
              value={form.categoryId}
              onValueChange={(v) => setForm({ ...form, categoryId: v })}
              triggerClassName="h-9 w-full"
            />
          </Field>
        ) : (
          <Field label="Categoría">
            <div
              className="h-8 flex items-center px-2.5 rounded-md text-sm text-muted-foreground"
              style={{ background: 'var(--nl-bg-track)' }}
            >
              Transferencia
            </div>
          </Field>
        )}
        <Field label="Cuenta">
          <Select
            value={form.accountId || null}
            onValueChange={(v) => setForm({ ...form, accountId: v ?? '', isMsi: false, installmentTotal: '' })}
          >
            <SelectTrigger className="h-9 w-full">
              <SelectValue placeholder="Selecciona...">
                {(v: string | null) => payingAccounts.find((a) => a.id === v)?.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {payingAccounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      {form.type === 'transfer' && (
        <Field label="Cuenta destino">
          <Select
            value={form.contraAccountId || null}
            onValueChange={(v) => setForm({ ...form, contraAccountId: v ?? '' })}
          >
            <SelectTrigger className="h-9 w-full">
              <SelectValue placeholder="Selecciona...">
                {(v: string | null) => payingAccounts.find((a) => a.id === v)?.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {payingAccounts
                .filter((a) => a.id !== form.accountId)
                .map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Fecha">
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            className={`${selectClass} h-9 w-full`}
          />
        </Field>
        <Field label="Estado">
          <Select
            value={form.status}
            onValueChange={(v) => setForm({ ...form, status: (v as 'confirmed' | 'draft') ?? 'confirmed' })}
          >
            <SelectTrigger className="h-9 w-full">
              <SelectValue>{(v: 'confirmed' | 'draft') => (v === 'draft' ? 'Pendiente' : 'Completado')}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="confirmed">Completado</SelectItem>
              <SelectItem value="draft">Pendiente</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="Notas (opcional)">
        <textarea
          rows={2}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className={`${selectClass} w-full py-2 resize-none`}
        />
      </Field>

      {canBeMsi && (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isMsi}
              onChange={(e) => setForm({ ...form, isMsi: e.target.checked })}
            />
            ¿A meses sin intereses?
          </label>
          {form.isMsi && (
            <Field label="¿A cuántos meses?">
              <input
                type="number"
                min={2}
                step={1}
                value={form.installmentTotal}
                onChange={(e) => setForm({ ...form, installmentTotal: e.target.value })}
                className={`${selectClass} h-9 w-full`}
              />
            </Field>
          )}
        </div>
      )}

      {form.type === 'transfer' && !form.contraAccountId && (
        <p className="text-xs text-muted-foreground">Ojo: para transferencias, elige la cuenta destino arriba.</p>
      )}
      {isError && <p className="text-xs text-destructive">{apiErrorMessage(error)}</p>}

      <DialogFooter>
        <DialogCancelButton onClick={onClose}>Cancelar</DialogCancelButton>
        <DialogPrimaryButton pending={isPending} pendingLabel="Guardando..." disabled={!canSubmit}>
          Crear transacción
        </DialogPrimaryButton>
      </DialogFooter>
    </form>
  )
}
