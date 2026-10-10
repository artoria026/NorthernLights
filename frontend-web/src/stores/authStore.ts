import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@/types'

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  /** Inactivity limit the server enforces, in seconds (null until it says). */
  idleTimeoutSeconds: number | null
  user: User | null
  setTokens: (accessToken: string, refreshToken: string, idleTimeoutSeconds?: number) => void
  setIdleTimeoutSeconds: (seconds: number) => void
  setAccessToken: (accessToken: string) => void
  setUser: (user: User) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      idleTimeoutSeconds: null,
      user: null,
      setTokens: (accessToken, refreshToken, idleTimeoutSeconds) =>
        set((state) => ({
          accessToken,
          refreshToken,
          idleTimeoutSeconds: idleTimeoutSeconds ?? state.idleTimeoutSeconds,
        })),
      setIdleTimeoutSeconds: (idleTimeoutSeconds) => set({ idleTimeoutSeconds }),
      setAccessToken: (accessToken) => set({ accessToken }),
      setUser: (user) => set({ user }),
      logout: () => set({ accessToken: null, refreshToken: null, idleTimeoutSeconds: null, user: null }),
    }),
    { name: 'finanzas-auth' },
  ),
)

// Several tabs share one session (localStorage). When another tab signs out or
// rotates the refresh token, pick the change up here: otherwise this tab would
// keep a revoked/stale token until its next request fails.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === 'finanzas-auth') void useAuthStore.persist.rehydrate()
  })
}
