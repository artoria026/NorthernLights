import { CornerDownLeft, Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react'

type IconComp = ComponentType<{ size?: number; className?: string }>

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/.test(navigator.userAgent)

/** Anuncia el atajo de FormSubmitShortcut.tsx (eso es lo que de verdad envia
 * el form, esto solo lo anuncia). Va dentro de <DialogFooter>, nunca pegado
 * al boton -- apilarlo debajo del boton primario lo corria de su lugar de
 * siempre y lo desalineaba de Cancelar ("Propuesta 2 -- misma fila, extremo
 * opuesto" de atajo-guardar-propuestas.html). */
export function SubmitShortcutHint() {
  return (
    <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
      <kbd className="inline-flex items-center rounded border border-border bg-muted px-1 py-[1px] font-sans leading-none">
        {IS_MAC ? '⌘' : 'Ctrl'}
      </kbd>
      <span>+</span>
      <kbd className="inline-flex items-center rounded border border-border bg-muted px-1 py-[1px] leading-none">
        <CornerDownLeft size={9} />
      </kbd>
      <span>para guardar</span>
    </p>
  )
}

/** Fila estandar del pie de un dialogo: la pista de Ctrl/Cmd+Enter en el
 * extremo izquierdo, los botones (Cancelar/Guardar, o solo Guardar cuando el
 * form no tiene Cancelar propio y depende de la X del encabezado) agrupados
 * en el derecho. Usar esto en vez de armar el `<div className="flex justify-end...">`
 * a mano en cada pantalla -- es el unico lugar que sabe donde va el hint. */
export function DialogFooter({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-2 pt-1 ${className}`}>
      <SubmitShortcutHint />
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

/** Botonera estandar de los modales de la app ("Contorno tranquilo", elegida
 * junto con el usuario tras comparar 5 propuestas -- ver
 * modales-propuestas.html en la raiz del repo). El primario es un boton con
 * borde de acento sin relleno que se rellena solo al hover; Cancelar es
 * texto plano sin borde. El boton de cerrar (X) del encabezado ya esta
 * centralizado en components/ui/dialog.tsx -- este archivo es la otra mitad
 * del estandar, para no repetir la misma receta de clases en cada pantalla.
 *
 * `--primary`/`--primary-foreground` (index.css) YA apuntan a
 * --nl-accent-ink/--nl-accent-fg, asi que estas clases usan los tokens
 * semanticos de Tailwind en vez de var(--nl-*) directo -- se adaptan solas
 * a claro/oscuro igual que el resto de la app. */
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
      {pending ? (pendingLabel ?? 'Guardando...') : children}
    </button>
  )
}

export function DialogCancelButton({
  children = 'Cancelar',
  className = '',
  type = 'button',
  ...rest
}: { children?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
