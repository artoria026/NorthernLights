import { create } from 'zustand'

interface Toast {
  id: number
  message: string
  variant: 'error' | 'success'
}

interface UiState {
  toasts: Toast[]
  pushToast: (message: string, variant?: Toast['variant']) => void
  dismissToast: (id: number) => void
  /** AppSidebar dibuja el icono de "Novedades" dos veces (barra movil y
   * sidebar de escritorio), pero el modal en si (con su auto-apertura al
   * detectar una version nueva, ver ChangelogButton.tsx) debe existir UNA
   * sola vez -- si cada icono tuviera su propio estado local, las dos copias
   * se auto-abrian por separado y cerrar una revelaba la otra detras
   * (el changelog "salia dos veces"). Compartiendo este boolean, ambos
   * iconos son solo triggers de la misma ventana.
   */
  changelogOpen: boolean
  setChangelogOpen: (open: boolean) => void
}

let nextId = 1

export const useUiStore = create<UiState>((set) => ({
  toasts: [],
  pushToast: (message, variant = 'error') =>
    set((state) => ({ toasts: [...state.toasts, { id: nextId++, message, variant }] })),
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  changelogOpen: false,
  setChangelogOpen: (open) => set({ changelogOpen: open }),
}))
