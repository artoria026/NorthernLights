import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { TOUR_CONTENT } from '@/lib/tours'
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
const TOOLTIP_HEIGHT_ESTIMATE = 170
const PAD = 6

/** Motor del recorrido guiado, montado una sola vez en App.tsx. Sin
 * activeModuleKey no renderiza nada (costo cero en reposo). Portado de la
 * clase Tour en recorridos-propuestas.html -- misma mecanica visual (hueco +
 * tooltip animados con box-shadow 0 0 0 9999px), pero contra el viewport real
 * en vez del frame acotado del mockup, y con scrollIntoView + defensa ante
 * selector nulo (el mockup nunca necesito ninguna de las dos). */
export function TourHost() {
  const activeModuleKey = useTourStore((s) => s.activeModuleKey)
  const stepIndex = useTourStore((s) => s.stepIndex)
  const setStep = useTourStore((s) => s.setStep)
  const stop = useTourStore((s) => s.stop)
  const [rect, setRect] = useState<Rect | null>(null)

  const content = activeModuleKey ? TOUR_CONTENT[activeModuleKey] : undefined
  const step = content?.steps[stepIndex]

  useEffect(() => {
    if (!step) {
      setRect(null)
      return
    }
    const target = document.querySelector(step.selector)
    if (!target) {
      // Selector no encontrado -- el modulo no tiene datos para este paso, o
      // el usuario navego fuera a medio tour. Termina en silencio en vez de
      // quedar con un overlay huerfano.
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

  if (!activeModuleKey || !content || !step || !rect) return null

  const total = content.steps.length
  const isLast = stepIndex === total - 1

  const holeStyle = {
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  }

  let tooltipTop = rect.top + rect.height + 14
  if (tooltipTop + TOOLTIP_HEIGHT_ESTIMATE > window.innerHeight) {
    tooltipTop = Math.max(10, rect.top - TOOLTIP_HEIGHT_ESTIMATE - 10)
  }
  const tooltipLeft = Math.min(Math.max(rect.left, 10), window.innerWidth - TOOLTIP_WIDTH - 10)

  return createPortal(
    <>
      {/* Captura clicks sobre el resto de la pantalla mientras el recorrido
          esta activo -- evita cambios de estado accidentales a medio tour;
          clickear afuera lo termina, igual que Saltar. */}
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
        className="fixed z-[101] flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-2xl transition-[top,left] duration-[380ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{ top: tooltipTop, left: tooltipLeft, width: TOOLTIP_WIDTH }}
      >
        <div>
          <div
            className="text-[10px] font-bold uppercase tracking-wide mb-1"
            style={{ color: 'var(--nl-accent-ink)' }}
          >
            Paso {stepIndex + 1} de {total}
          </div>
          <div className="text-[13.5px] font-semibold mb-1">{step.title}</div>
          <p className="text-xs text-muted-foreground leading-relaxed">{step.text}</p>
        </div>
        <div className="flex gap-1">
          {content.steps.map((_, i) => (
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
              Atrás
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
              Saltar
            </button>
            <button
              type="button"
              onClick={() => (isLast ? stop() : setStep(stepIndex + 1))}
              className="rounded-md px-3 py-1.5 text-[11.5px] font-semibold"
              style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
            >
              {isLast ? 'Listo' : 'Siguiente'}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}
