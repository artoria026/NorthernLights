import { Check } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DialogFooter, DialogPrimaryButton } from '@/components/nl/DialogActions'
import { useAccounts } from '@/hooks/useAccounts'
import { useCreateTransaction } from '@/hooks/useTransactions'
import { apiErrorMessage } from '@/services/api'
import { formatMoney, selectClass } from '@/lib/utils'
import { useUiStore } from '@/stores/uiStore'
import type { Account } from '@/types'

/** Paying a credit card is always a real transfer between accounts -- with
 * credit cards outside the Deudas model (see redesign), this is the only
 * way to record a payment, from Cuentas or from Transacciones. */
export function PayCreditCardForm({ account, onDone }: { account: Account; onDone: () => void }) {
  const { t } = useTranslation('common')
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
        description: t('payCreditCardForm.paymentDescription', { name: account.name }),
        entry_type: 'transfer',
        lines: [
          { account_id: account.id, amount, type: 'debit' },
          { account_id: sourceAccountId, amount, type: 'credit' },
        ],
      })
      pushToast(
        <Trans i18nKey="payCreditCardForm.paymentToast" ns="common" values={{ name: account.name }}>
          Pago a <strong className="font-bold" /> registrado
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
        {t('payCreditCardForm.currentBalance', { amount: formatMoney(account.balance) })}
      </p>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t('payCreditCardForm.sourceAccountLabel')}</label>
        <Select value={sourceAccountId || null} onValueChange={(v) => setSourceAccountId(v ?? '')}>
          <SelectTrigger className="h-9 w-full">
            <SelectValue placeholder={t('payCreditCardForm.accountPlaceholder')}>
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
        <label className="text-xs text-muted-foreground">{t('payCreditCardForm.amountLabel')}</label>
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
        <label className="text-xs text-muted-foreground">{t('payCreditCardForm.dateLabel')}</label>
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
          {t('payCreditCardForm.submitButton')}
        </DialogPrimaryButton>
      </DialogFooter>
    </form>
  )
}
