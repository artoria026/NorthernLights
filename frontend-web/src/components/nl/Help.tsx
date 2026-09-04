import { ArrowRight, CircleHelp } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** "?" button that goes in each screen's header (see ViewHeader in
 * primitives.tsx) and opens a modal with that screen's help content. Each
 * page builds its own content with <HelpSection>/<HelpTip>/<DemoFlow> from
 * this same file -- see e.g. Transactions.tsx. */
export function HelpTrigger({
  title,
  children,
  dataTourId,
}: {
  title: string
  children: ReactNode
  /** Optional anchor for the last step of the guided tour (see
   * TourHost.tsx) -- ViewHeader passes it as `<tourKey>:help-button`. */
  dataTourId?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Ayuda de esta pantalla"
        data-tour={dataTourId}
        className="p-1 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
      >
        <CircleHelp size={17} strokeWidth={1.8} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto" showCloseButton>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CircleHelp size={17} strokeWidth={1.8} style={{ color: 'var(--nl-accent)' }} />
              {title}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-5 text-[13px] pt-1">{children}</div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function HelpSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {heading}
      </h3>
      <div className="flex flex-col gap-2 text-foreground/85 leading-relaxed [&_strong]:text-foreground [&_strong]:font-medium">
        {children}
      </div>
    </div>
  )
}

/** Highlighted note inside a section -- for "watch out for this" / non-obvious
 * behaviors (e.g. that the backend resolves an internal account on its own). */
export function HelpTip({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-md border px-3 py-2 text-xs leading-relaxed"
      style={{ borderColor: 'var(--nl-accent)', background: 'var(--nl-accent-soft-bg)', color: 'var(--nl-accent-ink)' }}
    >
      {children}
    </div>
  )
}

type DemoTone = 'pos' | 'neg' | 'neutral' | 'warn'

const TONE_COLOR: Record<DemoTone, string> = {
  pos: 'var(--nl-accent)',
  neg: 'var(--nl-danger)',
  neutral: 'var(--nl-border-strong)',
  warn: 'var(--nl-warning)',
}

interface DemoItem {
  label: string
  sublabel?: string
  tone?: DemoTone
}

function DemoBox({ label, sublabel, tone = 'neutral' }: DemoItem) {
  const color = TONE_COLOR[tone]
  return (
    <div
      className="rounded-md border px-3 py-2 text-center min-w-[92px]"
      style={{ borderColor: color, background: 'var(--nl-bg-input)' }}
    >
      <div className="text-[11px] font-medium leading-tight">{label}</div>
      {sublabel && (
        <div className="text-[10px] mt-0.5 font-medium" style={{ color }}>
          {sublabel}
        </div>
      )}
    </div>
  )
}

/** Illustrative flow diagram (A -> B -> C) to show where money moves from
 * and to in a feature -- it's not a mockup of the real UI, it's a visual
 * explanation of the accounting effect. The arrow has a subtle animation
 * (pure CSS, no JS) so it feels "alive" instead of a static image. */
export function DemoFlow({ items }: { items: DemoItem[] }) {
  return (
    <div className="flex items-center gap-2 flex-wrap justify-center bg-card border border-border rounded-md p-3.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          {i > 0 && (
            <ArrowRight
              size={14}
              className="text-muted-foreground flex-shrink-0"
              style={{ animation: 'flowArrow 1.4s ease-in-out infinite' }}
            />
          )}
          <DemoBox {...item} />
        </div>
      ))}
    </div>
  )
}

/** Numbered step list, for "do this, then this" flows. */
export function DemoSteps({ steps }: { steps: string[] }) {
  return (
    <ol className="flex flex-col gap-1.5">
      {steps.map((step, i) => (
        <li key={i} className="flex items-start gap-2.5">
          <span
            className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-semibold mt-0.5"
            style={{ background: 'var(--nl-accent-soft-bg)', color: 'var(--nl-accent-ink)' }}
          >
            {i + 1}
          </span>
          <span className="text-foreground/85">{step}</span>
        </li>
      ))}
    </ol>
  )
}
