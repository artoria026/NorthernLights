import { CornerDownLeft, Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

type IconComp = ComponentType<{ size?: number; className?: string }>

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/.test(navigator.userAgent)

/** Announces the shortcut from FormSubmitShortcut.tsx (that's what actually
 * submits the form, this only announces it). Goes inside <DialogFooter>,
 * never stacked right under the button -- stacking it below the primary
 * button moved it from its usual place and misaligned it with Cancelar
 * ("Propuesta 2 -- misma fila, extremo opuesto" from
 * atajo-guardar-propuestas.html). */
export function SubmitShortcutHint() {
  const { t } = useTranslation('common')
  return (
    <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
      <kbd className="inline-flex items-center rounded border border-border bg-muted px-1 py-[1px] font-sans leading-none">
        {IS_MAC ? '⌘' : 'Ctrl'}
      </kbd>
      <span>+</span>
      <kbd className="inline-flex items-center rounded border border-border bg-muted px-1 py-[1px] leading-none">
        <CornerDownLeft size={9} />
      </kbd>
      <span>{t('dialogActions.submitHint')}</span>
    </p>
  )
}

/** Standard row for a dialog's footer: the Ctrl/Cmd+Enter hint on the far
 * left, the buttons (Cancelar/Guardar, or just Guardar when the form has no
 * Cancelar of its own and relies on the header's X) grouped on the right.
 * Use this instead of hand-building the `<div className="flex justify-end...">`
 * on each screen -- it's the only place that knows where the hint goes. */
export function DialogFooter({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-2 pt-1 ${className}`}>
      <SubmitShortcutHint />
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

/** Standard button group for the app's modals ("Contorno tranquilo", chosen
 * together with the user after comparing 5 proposals -- see
 * modales-propuestas.html at the repo root). The primary is a button with
 * an unfilled accent border that fills in only on hover; Cancelar is plain
 * text with no border. The header's close (X) button is already
 * centralized in components/ui/dialog.tsx -- this file is the other half
 * of the standard, so the same class recipe isn't repeated on every screen.
 *
 * `--primary`/`--primary-foreground` (index.css) ALREADY point to
 * --nl-accent-ink/--nl-accent-fg, so these classes use Tailwind's semantic
 * tokens instead of var(--nl-*) directly -- they adapt on their own to
 * light/dark just like the rest of the app. */
export function DialogPrimaryButton({
  icon: Icon,
  pending = false,
  pendingLabel,
  className = '',
  children,
  type = 'submit',
  disabled,
  ...rest
}: {
  icon?: IconComp
  pending?: boolean
  pendingLabel?: string
  children: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const { t } = useTranslation('common')
  return (
    <button
      type={type}
      disabled={pending || disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border border-primary px-4 py-2 text-[13px] font-semibold text-primary transition-colors duration-150 hover:bg-primary hover:text-primary-foreground disabled:pointer-events-none disabled:opacity-50 ${className}`}
      {...rest}
    >
      {pending ? (
        <Loader2 size={14} className="animate-spin" />
      ) : Icon ? (
        <Icon size={14} />
      ) : null}
      {pending ? (pendingLabel ?? t('dialogActions.savingPending')) : children}
    </button>
  )
}

export function DialogCancelButton({
  children,
  className = '',
  type = 'button',
  ...rest
}: { children?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const { t } = useTranslation('common')
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground ${className}`}
      {...rest}
    >
      {children ?? t('dialogActions.cancel')}
    </button>
  )
}
