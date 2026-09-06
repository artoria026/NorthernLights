import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useTourStore } from '@/stores/tourStore'

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

function measure(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

const TOOLTIP_WIDTH = 264
// Starting point for the first render of each step, before measuring the
// real height -- text lengths vary quite a bit (some steps are one line,
// others four), so a fixed number here often underestimates and leaves the
// tooltip cut off outside the viewport on anchors in the bottom half of the
// screen. tooltipHeight (measured with useLayoutEffect further below) is
// the real source of truth for the collision math.
const TOOLTIP_HEIGHT_ESTIMATE = 170
const PAD = 6

/** Guided tour engine, mounted once in App.tsx. Without activeModuleKey it
 * renders nothing (zero cost at rest). Ported from the Tour class in
 * recorridos-propuestas.html -- same visual mechanics (cutout + tooltip
 * animated with box-shadow 0 0 0 9999px), but against the real viewport
 * instead of the mockup's bounded frame, and with scrollIntoView + a guard
 * against a null selector (the mockup never needed either one). */
export function TourHost() {
  const { t } = useTranslation('common')
  const activeModuleKey = useTourStore((s) => s.activeModuleKey)
  const stepIndex = useTourStore((s) => s.stepIndex)
  const visibleSteps = useTourStore((s) => s.visibleSteps)
  const setStep = useTourStore((s) => s.setStep)
  const stop = useTourStore((s) => s.stop)
  const [rect, setRect] = useState<Rect | null>(null)
  const [tooltipHeight, setTooltipHeight] = useState(TOOLTIP_HEIGHT_ESTIMATE)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const nextButtonRef = useRef<HTMLButtonElement>(null)

  const step = visibleSteps[stepIndex]

  // Measures the tooltip's real height after this step's text has already
  // rendered -- useLayoutEffect runs before the browser paints, so if the
  // measured height differs from the estimate, the repositioning below
  // already uses the correct number in the same frame (no visible flicker).
  useLayoutEffect(() => {
    const measured = tooltipRef.current?.getBoundingClientRect().height
    if (measured && Math.abs(measured - tooltipHeight) > 1) setTooltipHeight(measured)
    // Only when the step's content changes -- the tooltip's height doesn't
    // depend on its own position (top/left), only on the text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  useEffect(() => {
    if (!step) {
      setRect(null)
      return
    }
    const target = document.querySelector(step.selector)
    if (!target) {
      // Selector not found -- the module has no data for this step, or the
      // user navigated away mid-tour. Ends silently instead of leaving an
      // orphaned overlay.
      stop()
      return
    }
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    function reflow() {
      setRect(measure(target as Element))
    }
    reflow()
    const raf = requestAnimationFrame(reflow)
    window.addEventListener('resize', reflow)
    window.addEventListener('scroll', reflow, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', reflow)
      window.removeEventListener('scroll', reflow, true)
    }
  }, [step, stop])

  // Automatic focus on "Siguiente"/"Listo" every time a step opens -- this
  // way pressing Enter alone (without touching the mouse) advances the
  // whole tour, regardless of whatever element had focus before (the
  // button that opened the tour, an input on the screen behind it, etc.).
  // Depends on `rect` and not just `step` because the button doesn't exist
  // in the DOM yet on the first render of each step (the whole component
  // returns null until `rect` resolves further below) -- this effect runs
  // again as soon as `rect` changes and the button is already mounted.
  useEffect(() => {
    nextButtonRef.current?.focus()
  }, [step, rect])

  if (!activeModuleKey || !step || !rect) return null

  const total = visibleSteps.length
  const isLast = stepIndex === total - 1

  const holeStyle = {
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  }

  let tooltipTop = rect.top + rect.height + 14
  if (tooltipTop + tooltipHeight > window.innerHeight) {
    tooltipTop = Math.max(10, rect.top - tooltipHeight - 10)
  }
  // Neither above nor below the element is reachable on short screens or
  // anchors very close to an edge -- this final clamp is what actually
  // guarantees the Siguiente/Atras buttons stay reachable, the branch above
  // is just the "which side looks better" heuristic.
  tooltipTop = Math.min(Math.max(tooltipTop, 10), window.innerHeight - tooltipHeight - 10)
  const tooltipLeft = Math.min(Math.max(rect.left, 10), window.innerWidth - TOOLTIP_WIDTH - 10)

  return createPortal(
    <>
      {/* Captures clicks on the rest of the screen while the tour is
          active -- prevents accidental state changes mid-tour; clicking
          outside ends it, same as Saltar. */}
      <div className="fixed inset-0 z-[99]" onClick={stop} aria-hidden="true" />
      <div
        className="fixed rounded-[10px] pointer-events-none z-[100] transition-[top,left,width,height] duration-[380ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{ ...holeStyle, boxShadow: '0 0 0 9999px rgba(0,0,0,.62)' }}
      >
        <span
          className="absolute -inset-0.5 rounded-[12px] border-2"
          style={{ borderColor: 'var(--nl-accent)', animation: 'tourRingPulse 1.6s ease-in-out infinite' }}
        />
      </div>
      <div
        ref={tooltipRef}
        className="fixed z-[101] flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-2xl transition-[top,left] duration-[380ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{ top: tooltipTop, left: tooltipLeft, width: TOOLTIP_WIDTH }}
      >
        <div>
          <div
            className="text-[10px] font-bold uppercase tracking-wide mb-1"
            style={{ color: 'var(--nl-accent-ink)' }}
          >
            {t('tourHost.stepCounter', { current: stepIndex + 1, total })}
          </div>
          <div className="text-[13.5px] font-semibold mb-1">{step.title}</div>
          <p className="text-xs text-muted-foreground leading-relaxed">{step.text}</p>
        </div>
        <div className="flex gap-1">
          {visibleSteps.map((_, i) => (
            <span
              key={i}
              className="h-[5px] rounded-full transition-all duration-200"
              style={{
                width: i === stepIndex ? 14 : 5,
                background: i === stepIndex ? 'var(--nl-accent)' : 'var(--nl-border-strong)',
              }}
            />
          ))}
        </div>
        <div className="flex items-center justify-between">
          {stepIndex > 0 ? (
            <button
              type="button"
              onClick={() => setStep(stepIndex - 1)}
              className="text-[11.5px] font-semibold text-muted-foreground hover:text-foreground"
            >
              {t('tourHost.backButton')}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={stop}
              className="text-[11.5px] font-semibold text-muted-foreground hover:text-foreground"
            >
              {t('tourHost.skipButton')}
            </button>
            <button
              ref={nextButtonRef}
              type="button"
              onClick={() => (isLast ? stop() : setStep(stepIndex + 1))}
              className="rounded-md px-3 py-1.5 text-[11.5px] font-semibold"
              style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
            >
              {isLast ? t('tourHost.doneButton') : t('tourHost.nextButton')}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}
