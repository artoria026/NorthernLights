import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useLogin } from '@/hooks/useAuth'
import { api, apiErrorMessage } from '@/services/api'
import { AuthLayout, type AuthValueProp } from './AuthLayout'

// Deliberately turned off: GOOGLE_CLIENT_ID/SECRET are still empty (see
// backend/app/core/config.py), so /auth/google/login today redirects to a
// Google URL that rejects the request. Instead of leaving the button active
// and showing a confusing error, it's disabled here -- a single line to
// turn it back on as soon as there's a real project in Google Cloud Console.
const GOOGLE_LOGIN_ENABLED = false

const VALUE_PROPS: AuthValueProp[] = [
  {
    icon: TrendingUp,
    title: 'Salud financiera en un vistazo',
    text: 'Ingresos, gastos y tendencias mes a mes, sin hojas de cálculo.',
  },
  {
    icon: ShieldCheck,
    title: 'Tus datos, tus reglas',
    text: 'Cada cuenta y transacción vive aislada por usuario.',
  },
  {
    icon: Sparkles,
    title: 'Un asesor con contexto real',
    text: 'La IA conoce tus finanzas y responde con eso en mente.',
  },
]

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const navigate = useNavigate()
  const login = useLogin()
  const [searchParams] = useSearchParams()
  const oauthMessage = searchParams.get('mensaje')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      await login.mutateAsync({ email, password })
      navigate('/')
    } catch {
      // invalid credentials: only the password gets cleared, the email is kept
      setPassword('')
    }
  }

  async function handleDevLogin() {
    try {
      await login.mutateAsync({
        email: 'test@local.dev',
        password: 'test1234',
      })
      navigate('/')
    } catch {
      setPassword('')
    }
  }

  const errorMessage = login.isError ? apiErrorMessage(login.error) : oauthMessage

  return (
    <AuthLayout
      heroTitle="Claridad financiera, sin el ruido."
      heroSubtitle="Cuentas, deudas, presupuesto y un asesor de IA que ya conoce tu historia — todo en un solo lugar."
      valueProps={VALUE_PROPS}
    >
      <h2 className="text-[22px] font-semibold tracking-tight mb-1.5">Bienvenido de nuevo</h2>
      <p className="text-[13px] text-muted-foreground mb-7">
        Inicia sesión para continuar con tus finanzas.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-[12px] font-medium text-muted-foreground">
            Correo electrónico
          </label>
          <div className="relative">
            <Mail
              size={15}
              strokeWidth={2}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              className="w-full h-11 rounded-lg border border-border pl-9 pr-3 text-[14px] outline-none transition-colors focus:border-[var(--nl-accent)]"
              style={{ background: 'var(--nl-bg-input)' }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-[12px] font-medium text-muted-foreground">
            Contraseña
          </label>
          <div className="relative">
            <Lock
              size={15}
              strokeWidth={2}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full h-11 rounded-lg border border-border pl-9 pr-9 text-[14px] outline-none transition-colors focus:border-[var(--nl-accent)]"
              style={{ background: 'var(--nl-bg-input)' }}
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((v) => !v)}
              title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        {errorMessage && (
          <div
            className="flex items-start gap-2 rounded-md px-3 py-2.5 text-[12.5px]"
            style={{
              background: 'var(--nl-danger-soft-bg)',
              color: 'var(--nl-danger-ink)',
            }}
          >
            <AlertCircle size={14} strokeWidth={2} className="flex-shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={login.isPending}
          className="group w-full h-11 rounded-lg text-[14px] font-medium transition-opacity hover:opacity-90 disabled:opacity-60 mt-1 flex items-center justify-center gap-1.5"
          style={{
            background: 'var(--nl-accent)',
            color: 'var(--nl-accent-fg)',
          }}
        >
          {login.isPending ? (
            'Entrando...'
          ) : (
            <>
              Entrar
              <ArrowRight
                size={15}
                strokeWidth={2}
                className="transition-transform duration-200 group-hover:translate-x-1"
              />
            </>
          )}
        </button>

        <div className="relative my-1.5">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" style={{ borderColor: 'var(--nl-border)' }} />
          </div>
          <div className="relative flex justify-center text-[11px] text-muted-foreground">
            <span className="px-2" style={{ background: 'var(--nl-bg-page)' }}>
              o continúa con
            </span>
          </div>
        </div>

        <button
          type="button"
          disabled={!GOOGLE_LOGIN_ENABLED}
          title={GOOGLE_LOGIN_ENABLED ? undefined : 'Todavía no disponible'}
          onClick={() => {
            if (!GOOGLE_LOGIN_ENABLED) return
            window.location.href = `${api.defaults.baseURL}/auth/google/login`
          }}
          className="w-full h-11 flex items-center justify-center gap-2 rounded-lg border text-[14px] transition-colors hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          style={{ borderColor: 'var(--nl-border)' }}
        >
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
            <path
              fill="#FFC107"
              d="M43.6 20.5H42V20H24v8h11.3C33.9 32.6 29.4 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
            />
            <path
              fill="#FF3D00"
              d="M6.3 14.7l6.6 4.8C14.6 15.6 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
            />
            <path
              fill="#4CAF50"
              d="M24 44c5.3 0 10.1-2 13.7-5.3l-6.3-5.3C29.4 35.4 26.8 36 24 36c-5.3 0-9.9-3.4-11.3-8.1l-6.5 5C9.6 39.6 16.2 44 24 44z"
            />
            <path
              fill="#1976D2"
              d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.1-3.3 5.6-6.2 7.1l6.3 5.3C39.9 37.5 44 31.7 44 24c0-1.3-.1-2.7-.4-3.5z"
            />
          </svg>
          Continuar con Google
          {!GOOGLE_LOGIN_ENABLED && (
            <span className="text-[11px] text-muted-foreground">(próximamente)</span>
          )}
        </button>

        {import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEV_LOGIN === 'true' && (
          <button
            type="button"
            onClick={handleDevLogin}
            disabled={login.isPending}
            title="Solo visible en desarrollo con VITE_ENABLE_DEV_LOGIN=true -- no sale en el build de produccion"
            className="w-full h-9 rounded-lg border border-dashed text-[12.5px] text-muted-foreground hover:text-foreground disabled:opacity-60 transition-colors"
            style={{ borderColor: 'var(--nl-warning)' }}
          >
            Usar cuenta de prueba (solo dev)
          </button>
        )}

        <p className="text-[13px] text-center text-muted-foreground mt-2">
          ¿No tienes cuenta?{' '}
          <Link
            to="/register"
            viewTransition
            className="font-medium"
            style={{ color: 'var(--nl-accent-ink)' }}
          >
            Regístrate
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
