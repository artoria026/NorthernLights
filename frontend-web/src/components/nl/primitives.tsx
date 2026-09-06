import { Compass } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { HelpTrigger } from '@/components/nl/Help'
import { WelcomeModal } from '@/components/nl/WelcomeModal'
import { categoryColor } from '@/lib/categoryColor'
import { getTourContent, type ModuleKey } from '@/lib/tours'
import { hasSeenTourWelcome, markTourWelcomeSeen } from '@/lib/tourSeen'
import { useTourStore } from '@/stores/tourStore'

/** Same color scheme the sidebar already uses to group Inicio/Cuentas/
 * Transacciones/Presupuesto/Categorías/Metas ("Diario"), Deudas/Recurrentes/
 * Suscripciones ("Compromisos") and Asesor IA/Insights/Reportes
 * ("Inteligencia") -- see navbar-and-font-proposals.html, Nav 02. Only
 * account or system screens (Ajustes, Notificaciones, Admin) don't belong
 * to any group and simply don't pass `section` to ViewHeader. */
// `label` holds an i18n key (under the `primitives` namespace of the
// `common` bundle), not the display text -- ViewHeader is the only place
// that reads it, and it resolves it through t() so the sidebar's section
// eyebrow follows the active UI language. Keeping the key here (rather than
// storing already-resolved text) means this object can stay a plain module-level
// const instead of being computed inside a component.
export const HEADER_SECTIONS = {
  diario: { label: 'primitives.sections.diario', color: 'var(--nl-accent)', ink: 'var(--nl-accent-ink)' },
  compromisos: { label: 'primitives.sections.compromisos', color: 'var(--nl-blue)', ink: 'var(--nl-blue-ink)' },
  inteligencia: { label: 'primitives.sections.inteligencia', color: 'var(--nl-violet)', ink: 'var(--nl-violet-ink)' },
} as const

export type HeaderSection = (typeof HEADER_SECTIONS)[keyof typeof HEADER_SECTIONS]

/** Single header for the whole app, no exceptions -- combines proposals 3
 * (color accent below the title), 4 (eyebrow + subtitle) and 5 (sticky on
 * scroll) from header-proposals.html. It's the SAME card as StatCard and
 * any other container (same bg-card/border/radius) so it looks identical
 * across every screen, including Advisor.tsx -- there, since its column
 * cancels the Layout padding on its own (so the chat fills the whole
 * screen), Advisor.tsx itself wraps this component in a div with positive
 * margin that gives normal padding back to the header only. */
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
  /** Content of this screen's help modal (HelpSection/HelpTip/DemoFlow
   * from components/nl/Help.tsx). If omitted, the "?" button doesn't appear. */
  help?: ReactNode
  /** One of HEADER_SECTIONS -- paints the eyebrow above the title and the
   * color stripe below. Omitted on screens with no assigned group. */
  section?: HeaderSection
  /** Optional context line below the title (e.g. the Inicio greeting). */
  subtitle?: ReactNode
  /** Module from tours.ts -- if getTourContent() has an entry for it, shows the
   * persistent "Recorrido" button and, the first time, the welcome modal
   * (see TourHost.tsx). Modules without an entry don't change anything
   * here yet -- incremental rollout without touching types. */
  tourKey?: ModuleKey
}) {
  const { t } = useTranslation('common')
  const startTour = useTourStore((s) => s.start)
  const [welcomeOpen, setWelcomeOpen] = useState(false)
  const tourContent = tourKey ? getTourContent(tourKey) : undefined

  useEffect(() => {
    if (tourKey && tourContent && !hasSeenTourWelcome(tourKey)) setWelcomeOpen(true)
    // Should only open once when the screen mounts, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourKey])

  return (
    <div
      // [transform:translateZ(0)] promotes the header to its own GPU
      // compositing layer -- without this, on some browsers/GPUs the sticky
      // element with rounded corners ends up repainting the same layer as
      // the content scrolling behind it, leaving a visible "ghosting"
      // (old frames flashing behind the header for an instant while
      // scrolling). [isolation:isolate] + [contain:paint] additionally
      // force its own paint context -- translateZ(0) alone wasn't enough to
      // eliminate the ghosting, this stops the browser from reusing pixels
      // from the layer below when repainting the header. Careful:
      // contain:paint clips any header child that needs to paint outside
      // its box (tooltips, dropdowns) -- today ViewHeader has none.
      className="sticky top-3 z-10 mb-6 rounded-md border border-border bg-card px-4 lg:px-8 py-3.5 [transform:translateZ(0)] [isolation:isolate] [contain:paint]"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          {section && (
            <div
              className="text-[10.5px] uppercase tracking-wide font-bold mb-0.5"
              style={{ color: section.ink }}
            >
              {t(section.label)}
            </div>
          )}
          <div className="flex items-center gap-2.5">
            <span className="text-foreground [&>svg]:w-5 [&>svg]:h-5 [&>svg]:stroke-[1.8]">
              {icon}
            </span>
            <h1 className="text-xl font-medium m-0">{title}</h1>
            {help && (
              <HelpTrigger
                title={t('primitives.helpTitle', { title })}
                dataTourId={tourKey ? `${tourKey}:help-button` : undefined}
              >
                {help}
              </HelpTrigger>
            )}
            {tourContent && (
              <button
                type="button"
                onClick={() => startTour(tourKey as ModuleKey)}
                title={t('primitives.tourButtonTitle')}
                className="flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[10.5px] font-semibold text-muted-foreground hover:text-primary hover:border-primary transition-colors flex-shrink-0"
              >
                <Compass size={12} />
                {t('primitives.tourButtonLabel')}
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
          // w-full on mobile -- once this block drops to its own line (the
          // flex-wrap of the row above), it's still flex-shrink-0 on the
          // inside and never shrinks below its content's natural width
          // unless it has a real width to shrink from first. On desktop
          // it goes back to w-auto to sit next to the title as before.
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
  /** Smaller version (less padding, icon closer, smaller value) --
   * optional and one-sided: nobody else asks for it today, only
   * Dashboard.tsx uses it so the 6 cards above take up less height. */
  compact?: boolean
  /** Optional anchor for a step of the guided tour (see TourHost.tsx). */
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
  'aria-label': ariaLabel,
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (value: T) => void
  className?: string
  'aria-label'?: string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`inline-flex rounded-md p-0.5 border border-border ${className ?? ''}`}
      style={{ background: 'var(--nl-bg-input)' }}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          title={opt.title}
          aria-pressed={value === opt.value}
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

/** `color` is the category's REAL color (category.color, see Categorias)
 * -- pass it whenever you have category_id available. The name-based hash
 * (categoryColor) only applies as a fallback when there's no real category
 * behind it (e.g. "Transferencia"/"Préstamo" instead of a category). */
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
