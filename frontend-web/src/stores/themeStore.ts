import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Theme } from '@/types'

interface ThemeState {
  mode: Theme
  toggle: () => void
  /** Fija el tema sin invertirlo -- para cuando la cuenta (backend) trae un
   * valor distinto al que quedo guardado en este navegador. */
  setMode: (mode: Theme) => void
  apply: () => void
}

function applyMode(mode: Theme) {
  document.documentElement.classList.toggle('dark', mode === 'dark')
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: 'dark',
      toggle: () => {
        const next = get().mode === 'dark' ? 'light' : 'dark'
        applyMode(next)
        set({ mode: next })
      },
      setMode: (mode) => {
        if (mode === get().mode) return
        applyMode(mode)
        set({ mode })
      },
      apply: () => applyMode(get().mode),
    }),
    { name: 'finanzas-theme', onRehydrateStorage: () => (state) => state?.apply() },
  ),
)
