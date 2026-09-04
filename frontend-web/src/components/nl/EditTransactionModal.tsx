import { type FormEvent, useEffect, useState } from 'react'
import { DialogCancelButton, DialogFooter, DialogPrimaryButton } from '@/components/nl/DialogActions'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CategorySelect } from '@/components/nl/CategorySelect'
import { useAccounts } from '@/hooks/useAccounts'
import { useCategories } from '@/hooks/useCategories'
import { useUpdateTransaction } from '@/hooks/useTransactions'
import { apiErrorMessage } from '@/services/api'
import { selectClass } from '@/lib/utils'
import type { Transaction } from '@/types'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

export function EditTransactionModal({
  transaction,
  onClose,
}: {
  transaction: Transaction | null
  onClose: () => void
}) {
  const { data: accounts } = useAccounts()
  const isTransfer = transaction?.entry_type === 'transfer'
  const { data: categories } = useCategories(
    transaction && !isTransfer ? (transaction.entry_type as 'income' | 'expense') : undefined,
  )
  const updateTransaction = useUpdateTransaction()
  const payingAccounts = accounts?.filter((a) => a.type === 'asset' || a.type === 'liability') ?? []

  const [date, setDate] = useState('')
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [contraAccountId, setContraAccountId] = useState('')
  const [amount, setAmount] = useState('')

  useEffect(() => {
    if (!transaction || !accounts) return
    setDate(transaction.date)
    setDescription(transaction.description)
    setNotes(transaction.notes ?? '')
    setCategoryId(transaction.category_id ?? '')
    setAmount(transaction.amount ?? '')

    if (transaction.entry_type === 'transfer') {
      // Creation convention (see TransactionModals.tsx): destination=debit, origin=credit.
      setContraAccountId(transaction.lines.find((l) => l.type === 'debit')?.account_id ?? '')
      setAccountId(transaction.lines.find((l) => l.type === 'credit')?.account_id ?? '')
    } else {
      // One of the 2 lines is the category's internal ledger account (it
      // doesn't appear in `accounts`, which only brings real accounts) --
      // the other is the real account the user picks. We don't assume a
      // fixed order.
      const realLine = transaction.lines.find((l) => accounts.some((a) => a.id === l.account_id))
      setAccountId(realLine?.account_id ?? '')
      setContraAccountId('')
    }
  }, [transaction, accounts])

  const amountValid = Number(amount) > 0
  const missingCategory = !isTransfer && !categoryId
  const missingDestination = isTransfer && !contraAccountId
  const canSubmit =
    !!transaction && amountValid && !!accountId && !missingCategory && !missingDestination

  async function submit() {
    if (!transaction || !canSubmit) return
    try {
      if (isTransfer) {
        await updateTransaction.mutateAsync({
          id: transaction.id,
          input: {
            date,
            description,
            notes: notes || undefined,
            lines: [
              { account_id: contraAccountId, amount, type: 'debit' },
              { account_id: accountId, amount, type: 'credit' },
            ],
          },
        })
      } else {
        await updateTransaction.mutateAsync({
          id: transaction.id,
          input: {
            date,
            description,
            notes: notes || undefined,
            category_id: categoryId,
            account_id: accountId,
            amount,
          },
        })
      }
      onClose()
    } catch {
      // error shown below
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void submit()
  }

  return (
    <Dialog open={transaction !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg p-6" showCloseButton>
        <DialogHeader>
          <DialogTitle>Editar transacción</DialogTitle>
        </DialogHeader>
        {transaction && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="number"
              step="0.01"
              placeholder="$0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="text-xl font-light bg-transparent border-b border-border outline-none py-1 focus:border-ring"
            />
            <input
              placeholder="Descripción"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`${selectClass} h-9`}
            />
            <div className="grid grid-cols-2 gap-3">
              {!isTransfer ? (
                <Field label="Categoría">
                  <CategorySelect
                    categories={categories}
                    value={categoryId}
                    onValueChange={setCategoryId}
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
              <Field label={isTransfer ? 'Cuenta origen' : 'Cuenta'}>
                <Select value={accountId || null} onValueChange={(v) => setAccountId(v ?? '')}>
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
            {isTransfer && (
              <Field label="Cuenta destino">
                <Select
                  value={contraAccountId || null}
                  onValueChange={(v) => setContraAccountId(v ?? '')}
                >
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue placeholder="Selecciona...">
                      {(v: string | null) => payingAccounts.find((a) => a.id === v)?.name}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {payingAccounts
                      .filter((a) => a.id !== accountId)
                      .map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field label="Fecha">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={`${selectClass} h-9 w-full`}
              />
            </Field>
            <Field label="Notas (opcional)">
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={`${selectClass} w-full py-2 resize-none`}
              />
            </Field>

            {updateTransaction.isError && (
              <p className="text-xs text-destructive">{apiErrorMessage(updateTransaction.error)}</p>
            )}
            <DialogFooter>
              <DialogCancelButton onClick={onClose}>Cancelar</DialogCancelButton>
              <DialogPrimaryButton pending={updateTransaction.isPending} disabled={!canSubmit}>
                Guardar
              </DialogPrimaryButton>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
