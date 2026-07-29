import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUpdateSettings } from '@/hooks/useAuth'
import { LATEST_CHANGELOG_VERSION } from '@/lib/changelog'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import type { ApiSuccess, User } from '@/types'

const ERROR_MESSAGES: Record<string, string> = {
  google_cancelled: 'Cancelaste el inicio de sesión con Google.',
  invalid_state: 'La sesión expiró. Intenta de nuevo.',
  google_exchange_failed: 'No pudimos conectar con Google. Intenta de nuevo.',
  account_disabled: 'Esta cuenta está desactivada.',
  server_error: 'Ocurrió un error inesperado.',
}

export function AuthCallback() {
  const navigate = useNavigate()
  const setTokens = useAuthStore((s) => s.setTokens)
  const setUser = useAuthStore((s) => s.setUser)
  const updateSettings = useUpdateSettings()
  const handled = useRef(false)

  useEffect(() => {
    // StrictMode corre los efectos 2 veces en dev -- sin este guard, la
    // segunda pasada lee `window.location.search` DESPUES de que la primera
    // ya navego (y por lo tanto ya no tiene ?error=/?access_token=), asi que
    // recalcula un mensaje generico y pisa el correcto. Procesar la URL una
    // sola vez por montaje evita eso.
    if (handled.current) return
    handled.current = true

    const params = new URLSearchParams(window.location.search)
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    const error = params.get('error')
    const isNewAccount = params.get('is_new') === '1'

    if (error || !accessToken || !refreshToken) {
      const mensaje = ERROR_MESSAGES[error ?? ''] ?? 'Ocurrió un error.'
      navigate(`/login?mensaje=${encodeURIComponent(mensaje)}`, { replace: true })
      return
    }

    setTokens(accessToken, refreshToken)
    window.history.replaceState({}, '', '/auth/callback')
    ;(async () => {
      try {
        const me = await api.get<ApiSuccess<User>>('/auth/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        setUser(me.data.data)
        // Cuenta de Google recien creada: mismo criterio que Register.tsx --
        // no vio ningun release, no tiene sentido mostrarle "Novedades".
        if (isNewAccount) {
          try {
            await updateSettings.mutateAsync({
              last_seen_changelog_version: LATEST_CHANGELOG_VERSION,
            })
          } catch {
            // no-op: en el peor caso ve el modal de novedades una vez
          }
        }
        navigate('/', { replace: true })
      } catch {
        navigate('/login?mensaje=Ocurri%C3%B3%20un%20error.', { replace: true })
      }
    })()
  }, [navigate, setTokens, setUser, updateSettings])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
      <p className="text-muted-foreground">Iniciando sesión...</p>
    </div>
  )
}
