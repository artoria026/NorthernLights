import type { ReactNode } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import type { TourContent } from '@/lib/tours'

export function WelcomeModal({
  open,
  onOpenChange,
  icon,
  title,
  content,
  onStartTour,
  onDismiss,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  icon: ReactNode
  title: string
  content: TourContent['welcome']
  onStartTour: () => void
  onDismiss: () => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-[340px] p-6" showCloseButton={false}>
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center mb-3.5 [&>svg]:w-5 [&>svg]:h-5"
          style={{ background: 'var(--nl-accent-soft-bg)', color: 'var(--nl-accent-ink)' }}
        >
          {icon}
        </div>
        <h3 className="text-base font-bold mb-2">Bienvenido a {title}</h3>
        <p className="text-[12.5px] text-muted-foreground leading-relaxed mb-3">{content.description}</p>
        <ul className="flex flex-col gap-1.5 mb-5">
          {content.bullets.map((bullet, i) => (
            <li key={i} className="flex gap-1.5 text-xs text-muted-foreground">
              <span className="font-bold flex-shrink-0" style={{ color: 'var(--nl-accent-ink)' }}>
                ✓
              </span>
              {bullet}
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onStartTour}
            className="rounded-md py-2.5 text-[12.5px] font-bold"
            style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
          >
            Iniciar recorrido guiado →
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Explorar por mi cuenta
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
