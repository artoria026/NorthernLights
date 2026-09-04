import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Theme } from '@/types'

interface ThemeState {
  mode: Theme
  toggle: () => void
  /** Sets the theme without toggling it -- for when the account (backend) carries a
   * different value than what was saved in this browser. */
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
