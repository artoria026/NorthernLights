import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react'

type IconComp = ComponentType<{ size?: number; className?: string }>

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
