import { Check, ReceiptText } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { DialogFooter, DialogPrimaryButton } from '@/components/nl/DialogActions'
import { useRegisterRecurringCharge } from '@/hooks/useRecurring'
import { formatMoney, localIsoDate, selectClass } from '@/lib/utils'
import { apiErrorMessage } from '@/services/api'

/** "Register this month's charge" for an item the user follows by hand (the app does not
 * generate its charges). Opens a small form with the date -- today by default -- and, on
 * confirm, records the charge and moves the item's next date one period forward.
 * `highlight` is for a charge that is already due: it stands out from the quiet outline. */
export function RegisterChargeButton({
  item,
  highlight = false,
}: {
  item: { id: string; name: string; amount: string }
  highlight?: boolean
}) {
  const { t } = useTranslation('pages')
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(() => localIsoDate())
  const register = useRegisterRecurringCharge()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      await register.mutateAsync({ id: item.id, date })
      setOpen(false)
    } catch {
      // error shown below
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setDate(localIsoDate())
      }}
    >
      <DialogTrigger
        render={
          <button
            type="button"
            className="flex flex-shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] border hover:text-foreground"
            style={
              highlight
                ? {
                    background: 'var(--nl-warning-soft-bg)',
                    color: 'var(--nl-warning-ink)',
                    borderColor: 'var(--nl-warning-ink)',
                  }
                : { color: 'var(--nl-text-secondary)', borderColor: 'var(--nl-border)' }
            }
          >
            <ReceiptText size={11} />
            {t('recurring.registerCharge.button')}
          </button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('recurring.registerCharge.title', { name: item.name })}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {t('recurring.registerCharge.description', { amount: formatMoney(item.amount) })}
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">{t('recurring.registerCharge.dateLabel')}</label>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={`${selectClass} h-9 w-full`}
            />
          </div>
          {register.isError && <p className="text-sm text-destructive">{apiErrorMessage(register.error)}</p>}
          <DialogFooter>
            <DialogPrimaryButton icon={Check} pending={register.isPending}>
              {t('recurring.registerCharge.confirm')}
            </DialogPrimaryButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
