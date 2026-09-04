import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import { useThemeStore } from '@/stores/themeStore'
import type { ApiSuccess, Theme, TokenPair, User } from '@/types'

export function useLogin() {
  const setTokens = useAuthStore((s) => s.setTokens)
  const setUser = useAuthStore((s) => s.setUser)

  return useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      const { data } = await api.post<ApiSuccess<TokenPair>>('/auth/login', input)
      return data.data
    },
    onSuccess: async (tokens) => {
      setTokens(tokens.access_token, tokens.refresh_token)
      const me = await api.get<ApiSuccess<User>>('/auth/me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })
      setUser(me.data.data)
    },
  })
}

export function useLogout() {
  const refreshToken = useAuthStore((s) => s.refreshToken)
  const clearAuth = useAuthStore((s) => s.logout)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      // Best-effort: if the request fails (no network, token already invalid) the
      // user should still be able to log out -- local state is always
      // cleared, regardless of whether the backend managed to revoke the refresh token.
      if (refreshToken) {
        await api.post('/auth/logout', { refresh_token: refreshToken }).catch(() => null)
      }
    },
    onSuccess: () => {
      clearAuth()
      queryClient.clear()
    },
  })
}

export function useRegister() {
  return useMutation({
    mutationFn: async (input: {
      email: string
      name: string
      password: string
      accept_disclaimer: boolean
    }) => {
      const { data } = await api.post<ApiSuccess<User>>('/auth/register', input)
      return data.data
    },
  })
}

export function useCurrentUser() {
  const accessToken = useAuthStore((s) => s.accessToken)
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<User>>('/auth/me')
      return data.data
    },
    enabled: !!accessToken,
    retry: false,
  })
}

export interface UpdateProfileInput {
  name: string
  avatar_url?: string | null
}

export function useUpdateProfile() {
  const setUser = useAuthStore((s) => s.setUser)
  return useMutation({
    mutationFn: async (input: UpdateProfileInput) => {
      const { data } = await api.put<ApiSuccess<User>>('/auth/me', input)
      return data.data
    },
    onSuccess: (user) => setUser(user),
  })
}

export function useChangePassword() {
  return useMutation({
    mutationFn: async (input: { current_password: string; new_password: string }) => {
      await api.put('/auth/change-password', input)
    },
  })
}

export function useDeleteAccount() {
  const clearAuth = useAuthStore((s) => s.logout)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (password?: string) => {
      await api.delete('/auth/me', { data: { password } })
    },
    onSuccess: () => {
      clearAuth()
      queryClient.clear()
    },
  })
}

/** The backend stamps the version (settings.DISCLAIMER_VERSION) itself --
 * unlike useUpdateSettings, this endpoint doesn't accept any value
 * from the client (see DisclaimerGate.tsx). */
export function useAcceptDisclaimer() {
  const setUser = useAuthStore((s) => s.setUser)
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<ApiSuccess<User>>('/auth/accept-disclaimer')
      return data.data
    },
    onSuccess: (user) => setUser(user),
  })
}

export function useUnlinkGoogle() {
  const setUser = useAuthStore((s) => s.setUser)
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<ApiSuccess<User>>('/auth/google/unlink')
      return data.data
    },
    onSuccess: (user) => setUser(user),
  })
}

export interface UpdateSettingsInput {
  theme?: Theme
  email_notifications?: boolean
  push_notifications?: boolean
  pay_cycle?: 'weekly' | 'biweekly' | 'monthly'
  debt_trouble_mode?: boolean
  last_seen_changelog_version?: string | null
}

export function useUpdateSettings() {
  const setUser = useAuthStore((s) => s.setUser)
  return useMutation({
    mutationFn: async (input: UpdateSettingsInput) => {
      const { data } = await api.put<ApiSuccess<User>>('/auth/settings', input)
      return data.data
    },
    onSuccess: (user) => setUser(user),
  })
}

/** Changing the theme must show up instantly (not wait for the server round-trip) and
 * stay saved on the account (not just in this browser) -- used both
 * by the sidebar toggle and the selector in Settings, to avoid
 * repeating the logic in both places. */
export function useSyncedTheme() {
  const mode = useThemeStore((s) => s.mode)
  const setMode = useThemeStore((s) => s.setMode)
  const updateSettings = useUpdateSettings()

  function setTheme(next: Theme) {
    setMode(next)
    updateSettings.mutate({ theme: next })
  }

  return { mode, setTheme, isPending: updateSettings.isPending }
}
