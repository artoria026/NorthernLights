import { Check, Trash2, X } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useConfirmStore } from '@/stores/confirmStore'

/** Reemplaza window.confirm() en toda la app. Se monta una sola vez en App
 * y cualquier pantalla lo dispara con useConfirmStore((s) => s.ask). */
export function ConfirmDialogHost() {
  const request = useConfirmStore((s) => s.request)
  const settle = useConfirmStore((s) => s.settle)

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && settle(false)}>
      {request && (
        <DialogContent className="sm:max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{request.title}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{request.message}</p>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => settle(false)}
              className="flex items-center gap-1.5 rounded px-4 py-2 text-[13px] border border-border text-muted-foreground hover:text-foreground"
            >
              <X size={14} />
              {request.cancelLabel}
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => settle(true)}
              className="flex items-center gap-1.5 rounded px-4 py-2 text-[13px] font-medium"
              style={
                request.variant === 'danger'
                  ? { background: 'var(--nl-danger)', color: '#fff' }
                  : { background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }
              }
            >
              {request.variant === 'danger' ? <Trash2 size={14} /> : <Check size={14} />}
              {request.confirmLabel}
            </button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}
