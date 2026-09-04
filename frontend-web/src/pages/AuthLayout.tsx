import type { LucideIcon } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import logoMain from '@/assets/logos/main.png'
import { Donut, GroupedBars, LineChart } from '@/lib/charts'
// Build version, shown at the bottom of this panel -- same source of truth
// as the sidebar footer (AppSidebar.tsx), don't hardcode the string here.
import pkg from '../../package.json'

export interface AuthValueProp {
  icon: LucideIcon
  title: string
  text: string
}

// Login and Register mount the same AuthLayout with different content, so
// every time you navigate from one to the other this component fully
// remounts -- 'animation' in the style triggers the entrance on every
// mount, without depending on any state. The text panel (left) slides in
// from the left; the form card (right) does NOT slide, it only fades
// in/out. viewTransitionName is a bonus: in browsers that support the View
// Transitions API (Chrome/Edge) it also cross-fades the old snapshot with
// the new one instead of a hard cut -- see the ::view-transition-* rules
// in index.css.
const heroCopyTransitionStyle: CSSProperties = {
  viewTransitionName: 'auth-hero-copy',
  animation: 'authInLeft 1400ms cubic-bezier(0.22, 1, 0.36, 1)',
} as CSSProperties
const formCardTransitionStyle: CSSProperties = {
  viewTransitionName: 'auth-form-card',
  animation: 'authFadeIn 500ms ease-out 120ms both',
} as CSSProperties

/** Fixed slides, same on Login and Register -- slide 0 uses the copy each
 * screen sends it (heroTitle/heroSubtitle/valueProps, see HeroCarousel);
 * these here are the feature "showcase" with sample data (not real -- this
 * is marketing for the access screen, not a dashboard) using the same
 * chart components as the rest of the app (lib/charts.tsx) so they feel
 * part of NorthernLights, not a separate mockup invented just for this
 * screen. */
const FEATURE_SLIDES: { title: string; subtitle: string; visual: ReactNode }[] = [
  {
    title: 'Tu salud financiera, mes a mes',
    subtitle: 'Ingresos, gastos y patrimonio en una sola vista, siempre actualizada.',
    visual: (
      <LineChart
        series={[8200, 9100, 8700, 10400, 11200, 12600]}
        xLabels={['Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago']}
        height={150}
      />
    ),
  },
  {
    title: 'Presupuesto por categoría, sin sorpresas',
    subtitle: 'Compará lo planeado contra lo que gastaste de verdad, categoría por categoría.',
    visual: (
      <GroupedBars
        groups={[
          { label: 'Comida', a: 3500, b: 3120 },
          { label: 'Transporte', a: 1800, b: 1950 },
          { label: 'Ocio', a: 1200, b: 890 },
          { label: 'Servicios', a: 2400, b: 2400 },
        ]}
        height={150}
        colorA="var(--nl-violet)"
        colorB="var(--nl-accent)"
      />
    ),
  },
  {
    title: 'Tus deudas, bajo control',
    subtitle: 'Mira cuánto ya pagaste de cada una, de un vistazo.',
    visual: (
      <Donut
        slices={[
          { value: 62, color: 'var(--nl-accent)' },
          { value: 38, color: 'var(--nl-bg-track)' },
        ]}
        size={140}
        strokeWidth={18}
        centerLabel="62%"
        centerSub="Pagado"
      />
    ),
  },
]

const SLIDE_INTERVAL_MS = 5000

/** Slide 0 is Login/Register's own copy (heroTitle/heroSubtitle/valueProps);
 * the following ones are FEATURE_SLIDES, the same on both screens. It
 * advances on its own every SLIDE_INTERVAL_MS; the dots below let you jump
 * to any of them and reset the timer (otherwise, jumping manually would
 * feel "at odds" with the auto-advance). */
function HeroCarousel({
  heroTitle,
  heroSubtitle,
  valueProps,
}: {
  heroTitle: string
  heroSubtitle: string
  valueProps: AuthValueProp[]
}) {
  const totalSlides = FEATURE_SLIDES.length + 1
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % totalSlides), SLIDE_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [totalSlides, index])

  return (
    <div className="relative flex flex-col gap-6 max-w-md" style={heroCopyTransitionStyle}>
      <div key={index} style={{ animation: 'heroSlideFade 500ms ease-out both', minHeight: 300 }}>
        {index === 0 ? (
          <>
            <div>
              <h1 className="text-[28px] font-semibold leading-tight tracking-tight mb-2">
                {heroTitle}
              </h1>
              <p className="text-[14px] text-muted-foreground leading-relaxed">{heroSubtitle}</p>
            </div>
            <div className="flex flex-col gap-5 mt-8">
              {valueProps.map((item) => (
                <div key={item.title} className="flex items-start gap-3">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{
                      background: 'var(--nl-accent-soft-bg)',
                      color: 'var(--nl-accent-ink)',
                    }}
                  >
                    <item.icon size={16} strokeWidth={2} />
                  </div>
                  <div>
                    <p className="text-[13px] font-medium">{item.title}</p>
                    <p className="text-[12px] text-muted-foreground">{item.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="mb-6">
              <h2 className="text-[22px] font-semibold leading-tight tracking-tight mb-2">
                {FEATURE_SLIDES[index - 1].title}
              </h2>
              <p className="text-[14px] text-muted-foreground leading-relaxed">
                {FEATURE_SLIDES[index - 1].subtitle}
              </p>
            </div>
            <div
              className="rounded-xl border p-5 flex items-center justify-center"
              style={{ borderColor: 'var(--nl-border)' }}
            >
              {FEATURE_SLIDES[index - 1].visual}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {Array.from({ length: totalSlides }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Ver pantalla ${i + 1} de ${totalSlides}`}
            className="h-1.5 rounded-full transition-all duration-300"
            style={{
              width: i === index ? '20px' : '6px',
              background: i === index ? 'var(--nl-accent)' : 'var(--nl-border-strong)',
            }}
          />
        ))}
      </div>
    </div>
  )
}

export function AuthLayout({
  heroTitle,
  heroSubtitle,
  valueProps,
  children,
}: {
  heroTitle: string
  heroSubtitle: string
  valueProps: AuthValueProp[]
  children: ReactNode
}) {
  return (
    <div className="min-h-screen flex" style={{ background: 'var(--nl-bg-page)' }}>
      <div
        className="hidden lg:flex w-[42%] flex-col justify-between p-12 relative overflow-hidden"
        style={{
          // This panel's own background (not --nl-bg-sidebar, that's the
          // app's real nav) -- deliberately lighter: the decorative gray
          // vectors baked into the logo's PNG (main.png) were barely
          // distinguishable against the near-pure black of --nl-bg-sidebar.
          background: '#1c1f26',
          borderRight: '1px solid var(--nl-border)',
        }}
      >
        <div
          className="absolute -top-24 -left-24 w-[420px] h-[420px] rounded-full opacity-20 blur-3xl pointer-events-none"
          style={{ background: 'var(--nl-accent)' }}
        />
        <div
          className="absolute bottom-[-140px] right-[-100px] w-[360px] h-[360px] rounded-full opacity-10 blur-3xl pointer-events-none"
          style={{ background: 'var(--nl-violet)' }}
        />

        <div className="relative">
          {/* -mt-12 -ml-12 cancels the panel's p-12: the PNG (main.png)
              carries the decorative wireframe starting practically at its
              corner (0,0) -- with normal padding it looked like it was
              floating, with a straight edge where the PNG canvas "cut"
              the lines mid-stroke. Pinned to the panel's actual edge, that
              cut lines up with the real border and stops being noticeable. */}
          <img
            src={logoMain}
            alt="NorthernLights"
            className="h-[440px] w-auto -mt-12 -ml-12"
          />
        </div>

        <HeroCarousel heroTitle={heroTitle} heroSubtitle={heroSubtitle} valueProps={valueProps} />

        <p className="relative text-[11px] text-muted-foreground">
          © {new Date().getFullYear()} NorthernLights · v{pkg.version}
        </p>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-12 overflow-hidden relative">
        {/* Same glow as the left panel, but mobile/tablet only (on desktop
            it's already there, and this side is deliberately left clean) --
            without this, the header with the logo felt like it was floating
            on an empty background before reaching the form. */}
        <div
          className="lg:hidden absolute -top-20 left-1/2 -translate-x-1/2 w-[360px] h-[360px] rounded-full opacity-20 blur-3xl pointer-events-none"
          style={{ background: 'var(--nl-accent)' }}
        />
        <div
          className="lg:hidden absolute top-16 -right-20 w-[260px] h-[260px] rounded-full opacity-10 blur-3xl pointer-events-none"
          style={{ background: 'var(--nl-violet)' }}
        />

        <div className="w-full max-w-[380px] relative z-10" style={formCardTransitionStyle}>
          <div className="flex lg:hidden flex-col items-center text-center gap-2 mb-8">
            <img src={logoMain} alt="NorthernLights" className="h-24 w-auto" />
            <p className="text-[12.5px] text-muted-foreground max-w-[280px]">{heroTitle}</p>
          </div>

          {children}
        </div>
      </div>
    </div>
  )
}
