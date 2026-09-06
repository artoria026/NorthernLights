import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useUpdateSettings } from '@/hooks/useAuth'
import { LATEST_CHANGELOG_VERSION } from '@/lib/changelog'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import type { ApiSuccess, User } from '@/types'

function buildErrorMessages(t: (key: string) => string): Record<string, string> {
  return {
    google_cancelled: t('auth.callback.errors.googleCancelled'),
    invalid_state: t('auth.callback.errors.invalidState'),
    google_exchange_failed: t('auth.callback.errors.googleExchangeFailed'),
    account_disabled: t('auth.callback.errors.accountDisabled'),
    server_error: t('auth.callback.errors.serverError'),
  }
}

export function AuthCallback() {
  const { t } = useTranslation('pages')
  const navigate = useNavigate()
  const setTokens = useAuthStore((s) => s.setTokens)
  const setUser = useAuthStore((s) => s.setUser)
  const updateSettings = useUpdateSettings()
  const handled = useRef(false)

  useEffect(() => {
    // StrictMode runs effects twice in dev -- without this guard, the
    // second pass reads `window.location.search` AFTER the first one has
    // already navigated (and therefore no longer has ?error=/?access_token=),
    // so it recomputes a generic message and overwrites the correct one.
    // Processing the URL only once per mount avoids that.
    if (handled.current) return
    handled.current = true

    const params = new URLSearchParams(window.location.search)
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    const error = params.get('error')
    const isNewAccount = params.get('is_new') === '1'

    if (error || !accessToken || !refreshToken) {
      const errorMessages = buildErrorMessages(t)
      const mensaje = errorMessages[error ?? ''] ?? t('auth.callback.errors.generic')
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
        // Newly created Google account: same criterion as Register.tsx --
        // it hasn't seen any release, no point showing it "Novedades".
        if (isNewAccount) {
          try {
            await updateSettings.mutateAsync({
              last_seen_changelog_version: LATEST_CHANGELOG_VERSION,
            })
          } catch {
            // no-op: worst case they see the changelog modal once
          }
        }
        navigate('/', { replace: true })
      } catch {
        navigate(`/login?mensaje=${encodeURIComponent(t('auth.callback.errors.generic'))}`, {
          replace: true,
        })
      }
    })()
  }, [navigate, setTokens, setUser, updateSettings, t])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
      <p className="text-muted-foreground">{t('auth.callback.loadingText')}</p>
    </div>
  )
}
