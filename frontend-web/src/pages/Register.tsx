import { AlertCircle, Eye, EyeOff, Lock, Mail, Rocket, ShieldCheck, Sparkles, User } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLogin, useRegister, useUpdateSettings } from '@/hooks/useAuth'
import { LATEST_CHANGELOG_VERSION } from '@/lib/changelog'
import { apiErrorMessage } from '@/services/api'
import { AuthLayout, type AuthValueProp } from './AuthLayout'

const VALUE_PROPS: AuthValueProp[] = [
  {
    icon: Rocket,
    title: 'Arrancá en minutos',
    text: 'Creá tu cuenta y empezá a cargar movimientos, sin configuración compleja.',
  },
  {
    icon: ShieldCheck,
    title: 'Privado desde el día uno',
    text: 'Tus cuentas y transacciones quedan aisladas — solo vos accedés a tus datos.',
  },
  {
    icon: Sparkles,
    title: 'Un asesor que te acompaña',
    text: 'Preguntale a la IA por tus gastos apenas cargues tus primeros movimientos.',
  },
]

export function Register() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const navigate = useNavigate()
  const register = useRegister()
  const login = useLogin()
  const updateSettings = useUpdateSettings()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      await register.mutateAsync({ email, name, password })
      await login.mutateAsync({ email, password })
      // Cuenta recien creada: no vio ningun release todavia, asi que no
      // tiene sentido mostrarle "Novedades" con features que nunca usó --
      // se marca como visto antes de navegar para que ChangelogButton no
      // llegue a auto-abrirse ni una vez (ver last_seen_changelog_version).
      // Con su propio try/catch: si esto falla, no debe bloquear el ingreso
      // (register+login ya son exitosos en este punto).
      try {
        await updateSettings.mutateAsync({ last_seen_changelog_version: LATEST_CHANGELOG_VERSION })
      } catch {
        // no-op: en el peor caso ve el modal de novedades una vez
      }
      navigate('/')
    } catch {
      // el error se muestra abajo
    }
  }

  const error = register.error ?? login.error
  const errorMessage = error ? apiErrorMessage(error) : null
  const isPending = register.isPending || login.isPending

  return (
    <AuthLayout
      heroTitle="Tu dinero, por fin ordenado."
      heroSubtitle="Creá tu cuenta gratis y empezá a ver tus finanzas con claridad desde el primer día."
      valueProps={VALUE_PROPS}
    >
      <h2 className="text-[22px] font-semibold tracking-tight mb-1.5">Creá tu cuenta</h2>
      <p className="text-[13px] text-muted-foreground mb-7">
        Empezá a organizar tus finanzas en un solo lugar.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="text-[12px] font-medium text-muted-foreground">
            Nombre
          </label>
          <div className="relative">
            <User
              size={15}
              strokeWidth={2}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              id="name"
              type="text"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tu nombre"
              className="w-full h-11 rounded-lg border border-border pl-9 pr-3 text-[14px] outline-none transition-colors focus:border-[var(--nl-accent)]"
              style={{ background: 'var(--nl-bg-input)' }}
            />
          </div>
        </div>

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
              minLength={8}
              autoComplete="new-password"
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
            style={{ background: 'var(--nl-danger-soft-bg)', color: 'var(--nl-danger-ink)' }}
          >
            <AlertCircle size={14} strokeWidth={2} className="flex-shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="w-full h-11 rounded-lg text-[14px] font-medium transition-opacity hover:opacity-90 disabled:opacity-60 mt-1"
          style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
        >
          {isPending ? 'Creando...' : 'Crear cuenta'}
        </button>

        <p className="text-[13px] text-center text-muted-foreground mt-2">
          ¿Ya tienes cuenta?{' '}
          <Link
            to="/login"
            viewTransition
            className="font-medium"
            style={{ color: 'var(--nl-accent-ink)' }}
          >
            Inicia sesión
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
