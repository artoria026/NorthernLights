import { Check } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DialogFooter, DialogPrimaryButton } from '@/components/nl/DialogActions'
import { useAccounts } from '@/hooks/useAccounts'
import { useCreateTransaction } from '@/hooks/useTransactions'
import { apiErrorMessage } from '@/services/api'
import { formatMoney, selectClass } from '@/lib/utils'
import { useUiStore } from '@/stores/uiStore'
import type { Account } from '@/types'

/** Pagar una TDC siempre es una transferencia real entre cuentas -- con
 * tarjetas de credito fuera del modelo de Deudas (ver rediseno), este es el
 * unico camino para registrar un pago, desde Cuentas o desde Transacciones. */
export function PayCreditCardForm({ account, onDone }: { account: Account; onDone: () => void }) {
  const { data: accounts } = useAccounts()
  const createTransaction = useCreateTransaction()
  const pushToast = useUiStore((s) => s.pushToast)
  const sourceAccounts = accounts?.filter((a) => a.type === 'asset') ?? []
  const [sourceAccountId, setSourceAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      await createTransaction.mutateAsync({
        date,
        description: `Pago ${account.name}`,
        entry_type: 'transfer',
        lines: [
          { account_id: account.id, amount, type: 'debit' },
          { account_id: sourceAccountId, amount, type: 'credit' },
        ],
      })
      pushToast(
        <>
          Pago a <strong className="font-bold">{account.name}</strong> registrado
        </>,
        'success',
      )
      onDone()
    } catch {
      // error mostrado abajo
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Saldo actual: {formatMoney(account.balance)}</p>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Cuenta que paga</label>
        <Select value={sourceAccountId || null} onValueChange={(v) => setSourceAccountId(v ?? '')}>
          <SelectTrigger className="h-9 w-full">
            <SelectValue placeholder="Selecciona una cuenta">
              {(v: string | null) => sourceAccounts.find((a) => a.id === v)?.name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {sourceAccounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Monto</label>
        <input
          type="number"
          step="0.01"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Fecha</label>
        <input
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      {createTransaction.isError && (
        <p className="text-sm text-destructive">{apiErrorMessage(createTransaction.error)}</p>
      )}
      <DialogFooter>
        <DialogPrimaryButton icon={Check} pending={createTransaction.isPending} disabled={!sourceAccountId}>
          Registrar pago
        </DialogPrimaryButton>
      </DialogFooter>
    </form>
  )
}
