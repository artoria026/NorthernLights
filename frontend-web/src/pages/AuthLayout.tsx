import type { LucideIcon } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Donut, GroupedBars, LineChart } from '@/lib/charts'
// Version del build, mostrada al pie de este panel -- misma fuente de verdad
// que el pie del sidebar (AppSidebar.tsx), no hardcodear el string aqui.
import pkg from '../../package.json'

function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="flex-shrink-0">
      <polygon points="12,2 22,12 12,22 2,12" fill="var(--nl-accent)" />
    </svg>
  )
}

export interface AuthValueProp {
  icon: LucideIcon
  title: string
  text: string
}

// Login y Register montan el mismo AuthLayout con contenido distinto, asi
// que cada vez que se navega de uno a otro este componente se vuelve a
// montar entero -- 'animation' en el style dispara la entrada en cada
// mount, sin depender de ningun estado. El panel de texto (izquierda) entra
// deslizando desde la izquierda; la card del form (derecha) NO desliza,
// solo se desvanece/aparece. viewTransitionName es un plus: en browsers con
// soporte para la View Transitions API (Chrome/Edge) ademas cruza el
// snapshot viejo con el nuevo en vez de cortar seco -- ver las reglas
// ::view-transition-* en index.css.
const heroCopyTransitionStyle: CSSProperties = {
  viewTransitionName: 'auth-hero-copy',
  animation: 'authInLeft 1400ms cubic-bezier(0.22, 1, 0.36, 1)',
} as CSSProperties
const formCardTransitionStyle: CSSProperties = {
  viewTransitionName: 'auth-form-card',
  animation: 'authFadeIn 500ms ease-out 120ms both',
} as CSSProperties

/** Slides fijos, iguales en Login y Register -- el slide 0 usa el copy que
 * le manda cada pantalla (heroTitle/heroSubtitle/valueProps, ver
 * HeroCarousel); estos de aca son la "vitrina" de features con datos de
 * ejemplo (no reales -- esto es marketing de la pantalla de acceso, no un
 * dashboard) usando los mismos componentes de chart que el resto de la app
 * (lib/charts.tsx) para que se sientan parte de NorthernLights, no un mockup
 * aparte inventado solo para esta pantalla. */
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

/** El slide 0 es el copy propio de Login/Register (heroTitle/heroSubtitle/
 * valueProps); los siguientes son FEATURE_SLIDES, iguales en ambas
 * pantallas. Avanza solo cada SLIDE_INTERVAL_MS; los puntos de abajo
 * permiten saltar a cualquiera y reinician el temporizador (si no, saltar
 * manualmente se sentiria "peleado" con el auto-avance). */
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
          background: 'var(--nl-bg-sidebar)',
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

        <div className="relative flex items-center gap-3">
          <Logo size={40} />
          <span className="text-[24px] font-semibold tracking-tight">NorthernLights</span>
        </div>

        <HeroCarousel heroTitle={heroTitle} heroSubtitle={heroSubtitle} valueProps={valueProps} />

        <p className="relative text-[11px] text-muted-foreground">
          © {new Date().getFullYear()} NorthernLights · v{pkg.version}
        </p>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-12 overflow-hidden relative">
        {/* Mismo glow que el panel izquierdo, pero solo mobile/tablet (en
            desktop ya esta ahi, y este lado queda deliberadamente limpio) --
            sin esto, el header con el logo se sentia flotando en un fondo
            vacio antes de llegar al form. */}
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
            <div className="flex items-center gap-2.5">
              <Logo size={26} />
              <span className="text-[17px] font-semibold tracking-tight">NorthernLights</span>
            </div>
            <p className="text-[12.5px] text-muted-foreground max-w-[280px]">{heroTitle}</p>
          </div>

          {children}
        </div>
      </div>
    </div>
  )
}
