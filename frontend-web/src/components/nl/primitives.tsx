import { Compass } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { HelpTrigger } from '@/components/nl/Help'
import { WelcomeModal } from '@/components/nl/WelcomeModal'
import { categoryColor } from '@/lib/categoryColor'
import { TOUR_CONTENT, type ModuleKey } from '@/lib/tours'
import { hasSeenTourWelcome, markTourWelcomeSeen } from '@/lib/tourSeen'
import { useTourStore } from '@/stores/tourStore'

/** Mismo tema de color que ya usa la sidebar para agrupar Inicio/Cuentas/
 * Transacciones/Presupuesto/Categorías/Metas ("Diario"), Deudas/Recurrentes/
 * Suscripciones ("Compromisos") y Asesor IA/Insights/Reportes ("Inteligencia")
 * -- ver navbar-and-font-proposals.html, Nav 02. Solo las pantallas de cuenta
 * o sistema (Ajustes, Notificaciones, Admin) no pertenecen a ningun grupo y
 * simplemente no pasan `section` a ViewHeader. */
export const HEADER_SECTIONS = {
  diario: { label: 'Diario', color: 'var(--nl-accent)', ink: 'var(--nl-accent-ink)' },
  compromisos: { label: 'Compromisos', color: 'var(--nl-blue)', ink: 'var(--nl-blue-ink)' },
  inteligencia: { label: 'Inteligencia', color: 'var(--nl-violet)', ink: 'var(--nl-violet-ink)' },
} as const

export type HeaderSection = (typeof HEADER_SECTIONS)[keyof typeof HEADER_SECTIONS]

/** Header unico para toda la app, sin excepciones -- combina las propuestas 3
 * (acento de color bajo el titulo), 4 (eyebrow + subtitulo) y 5 (sticky al
 * hacer scroll) de header-proposals.html. Es la MISMA tarjeta que StatCard y
 * cualquier otro contenedor (mismo bg-card/borde/radio) para que se vea igual
 * en todas las pantallas, incluida Advisor.tsx -- ahi, como su columna
 * cancela el padding del Layout por su cuenta (para que el chat ocupe toda
 * la pantalla), el propio Advisor.tsx envuelve este componente en un div con
 * margen positivo que le devuelve el padding normal solo al header. */
export function ViewHeader({
  icon,
  title,
  actions,
  help,
  section,
  subtitle,
  tourKey,
}: {
  icon: ReactNode
  title: string
  actions?: ReactNode
  /** Contenido del modal de ayuda de esta pantalla (HelpSection/HelpTip/DemoFlow
   * de components/nl/Help.tsx). Si se omite, no aparece el boton "?". */
  help?: ReactNode
  /** Uno de HEADER_SECTIONS -- pinta el eyebrow arriba del titulo y la
   * rayita de color debajo. Se omite en pantallas sin grupo asignado. */
  section?: HeaderSection
  /** Linea de contexto opcional debajo del titulo (ej. el saludo de Inicio). */
  subtitle?: ReactNode
  /** Modulo de tours.ts -- si tiene entrada en TOUR_CONTENT, muestra el
   * boton de "Recorrido" persistente y, la primera vez, el modal de
   * bienvenida (ver TourHost.tsx). Los modulos sin entrada todavia no
   * cambian nada aqui -- rollout incremental sin tocar tipos. */
  tourKey?: ModuleKey
}) {
  const startTour = useTourStore((s) => s.start)
  const [welcomeOpen, setWelcomeOpen] = useState(false)
  const tourContent = tourKey ? TOUR_CONTENT[tourKey] : undefined

  useEffect(() => {
    if (tourKey && tourContent && !hasSeenTourWelcome(tourKey)) setWelcomeOpen(true)
    // Solo debe abrirse una vez al montar la pantalla, no en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourKey])

  return (
    <div
      // [transform:translateZ(0)] promueve el header a su propia capa de
      // composicion GPU -- sin esto, en algunos navegadores/GPUs el sticky
      // con esquinas redondeadas queda repintando la misma capa que el
      // contenido que scrollea detras, y deja un "ghosting" visible (frames
      // viejos asomando un instante detras del header al scrollear).
      // [isolation:isolate] + [contain:paint] fuerzan ademas un contexto de
      // pintado propio -- translateZ(0) solo no alcanzo a eliminar el
      // ghosting, esto evita que el navegador reutilice pixeles de la capa
      // de abajo al repintar el header. Ojo: contain:paint recorta cualquier
      // hijo del header que necesite pintar fuera de su caja (tooltips,
      // dropdowns) -- hoy ViewHeader no tiene ninguno.
      className="sticky top-3 z-10 mb-6 rounded-md border border-border bg-card px-4 lg:px-8 py-3.5 [transform:translateZ(0)] [isolation:isolate] [contain:paint]"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          {section && (
            <div
              className="text-[10.5px] uppercase tracking-wide font-bold mb-0.5"
              style={{ color: section.ink }}
            >
              {section.label}
            </div>
          )}
          <div className="flex items-center gap-2.5">
            <span className="text-foreground [&>svg]:w-5 [&>svg]:h-5 [&>svg]:stroke-[1.8]">
              {icon}
            </span>
            <h1 className="text-xl font-medium m-0">{title}</h1>
            {help && (
              <HelpTrigger
                title={`Ayuda — ${title}`}
                dataTourId={tourKey ? `${tourKey}:help-button` : undefined}
              >
                {help}
              </HelpTrigger>
            )}
            {tourContent && (
              <button
                type="button"
                onClick={() => startTour(tourKey as ModuleKey)}
                title="Ver recorrido guiado"
                className="flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[10.5px] font-semibold text-muted-foreground hover:text-primary hover:border-primary transition-colors flex-shrink-0"
              >
                <Compass size={12} />
                Recorrido
              </button>
            )}
          </div>
          {section && (
            <div
              className="w-6 h-[3px] rounded-full mt-1.5 ml-[30px]"
              style={{ background: section.color }}
            />
          )}
          {subtitle && <p className="text-[12.5px] text-muted-foreground mt-1.5 ml-[30px]">{subtitle}</p>}
        </div>
        {actions && (
          // w-full en movil -- una vez que este bloque cae a su propia linea
          // (el flex-wrap del row de arriba), sigue siendo flex-shrink-0 por
          // dentro y nunca se encoge bajo el ancho natural de su contenido a
          // menos que tenga un ancho real del cual encoger primero. En
          // desktop vuelve a w-auto para sentarse junto al titulo como antes.
          <div className="flex items-center gap-3 flex-wrap w-full lg:w-auto lg:flex-shrink-0">
            {actions}
          </div>
        )}
      </div>
      {tourKey && tourContent && (
        <WelcomeModal
          open={welcomeOpen}
          onOpenChange={setWelcomeOpen}
          icon={icon}
          title={title}
          content={tourContent.welcome}
          onStartTour={() => {
            markTourWelcomeSeen(tourKey)
            setWelcomeOpen(false)
            startTour(tourKey)
          }}
          onDismiss={() => {
            markTourWelcomeSeen(tourKey)
            setWelcomeOpen(false)
          }}
        />
      )}
    </div>
  )
}

export function StatCard({
  icon,
  label,
  value,
  valueClassName,
  note,
  borderColor,
  compact,
  dataTour,
}: {
  icon?: ReactNode
  label: string
  value: ReactNode
  valueClassName?: string
  note?: ReactNode
  borderColor?: string
  /** Version mas chica (menos padding, icono mas pegado, valor mas chico) --
   * opcional y de un solo lado: nadie mas la pide hoy, solo Dashboard.tsx la
   * usa para que las 6 tarjetas de arriba ocupen menos alto. */
  compact?: boolean
  /** Ancla opcional para un paso del recorrido guiado (ver TourHost.tsx). */
  dataTour?: string
}) {
  return (
    <div
      className={`flex-1 bg-card border border-border rounded-md min-w-0 ${compact ? 'p-3' : 'p-[18px]'}`}
      style={borderColor ? { borderColor } : undefined}
      data-tour={dataTour}
    >
      {icon && (
        <span
          className={`text-muted-foreground block w-fit [&>svg]:w-[18px] [&>svg]:h-[18px] [&>svg]:stroke-[1.6] ${compact ? 'mb-1.5' : 'mb-3.5'}`}
        >
          {icon}
        </span>
      )}
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div
        className={`font-light mt-1 truncate ${compact ? 'text-[22px]' : 'text-[28px]'} ${valueClassName ?? ''}`}
      >
        {value}
      </div>
      {note && <div className="text-xs text-muted-foreground mt-1">{note}</div>}
    </div>
  )
}

export function ProgressBar({
  pct,
  color,
  height = 6,
}: {
  pct: number
  color?: string
  height?: number
}) {
  const clamped = Math.min(100, Math.max(0, pct))
  return (
    <div
      className="rounded-full overflow-hidden"
      style={{ height, background: 'var(--nl-bg-track)' }}
    >
      <div
        className="h-full rounded-full transition-[width] duration-150 ease-out"
        style={{ width: `${clamped}%`, background: color ?? 'var(--nl-accent)' }}
      />
    </div>
  )
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div
      className={`inline-flex rounded-md p-0.5 border border-border ${className ?? ''}`}
      style={{ background: 'var(--nl-bg-input)' }}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded px-3 py-1.5 text-[11px] transition-colors ${
            value === opt.value ? 'font-semibold' : 'text-muted-foreground hover:text-foreground'
          }`}
          style={
            value === opt.value
              ? { background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }
              : undefined
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="w-8 h-[18px] rounded-full relative transition-colors flex-shrink-0 disabled:opacity-50"
      style={{ background: checked ? 'var(--nl-accent)' : 'var(--nl-border)' }}
    >
      <span
        className="absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-[left]"
        style={{ left: checked ? '16px' : '2px' }}
      />
    </button>
  )
}

/** `color` es el color REAL de la categoria (category.color, ver Categorias)
 * -- pasalo siempre que tengas category_id disponible. El hash por nombre
 * (categoryColor) solo aplica como respaldo cuando no hay una categoria de
 * verdad detras (ej. "Transferencia"/"Préstamo" en vez de una categoria). */
export function CategoryBadge({ name, color }: { name: string; color?: string }) {
  return (
    <span
      className="inline-block border border-border rounded-full px-2.5 py-0.5 text-[11px] whitespace-nowrap"
      style={{ background: 'var(--nl-bg-input)', color: color ?? categoryColor(name) }}
    >
      {name}
    </span>
  )
}

type Severity = 'accent' | 'danger' | 'warning' | 'violet' | 'blue'

export function SoftBadge({ children, severity = 'accent' }: { children: ReactNode; severity?: Severity }) {
  return (
    <span
      className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{
        background: `var(--nl-${severity}-soft-bg, var(--nl-bg-track))`,
        color: `var(--nl-${severity}-ink, var(--nl-${severity}))`,
      }}
    >
      {children}
    </span>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-center text-[12px] text-muted-foreground py-7">{children}</p>
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: item.color }} />
          <span className="text-[11px] text-muted-foreground">{item.label}</span>
        </div>
      ))}
    </div>
  )
}
