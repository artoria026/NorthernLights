import type { LucideIcon } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'

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

        <div className="relative flex flex-col gap-8 max-w-md" style={heroCopyTransitionStyle}>
          <div>
            <h1 className="text-[28px] font-semibold leading-tight tracking-tight mb-2">
              {heroTitle}
            </h1>
            <p className="text-[14px] text-muted-foreground leading-relaxed">{heroSubtitle}</p>
          </div>

          <div className="flex flex-col gap-5">
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
        </div>

        <p className="relative text-[11px] text-muted-foreground">
          © {new Date().getFullYear()} NorthernLights
        </p>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-12 overflow-hidden">
        <div className="w-full max-w-[380px]" style={formCardTransitionStyle}>
          <div className="flex lg:hidden items-center gap-2.5 mb-8">
            <Logo size={22} />
            <span className="text-[15px] font-semibold tracking-tight">NorthernLights</span>
          </div>

          {children}
        </div>
      </div>
    </div>
  )
}
