import { create } from 'zustand'
import type { ReactNode } from 'react'

export interface Toast {
  id: number
  /** ReactNode (not just string) to be able to highlight part of the message
   * (e.g. an account name in bold) instead of wrapping it in
   * quotes -- see ToastHost.tsx. */
  message: ReactNode
  variant: 'error' | 'success'
}

interface UiState {
  toasts: Toast[]
  pushToast: (message: ReactNode, variant?: Toast['variant']) => void
  dismissToast: (id: number) => void
  /** AppSidebar renders the "Novedades" icon twice (mobile bar and
   * desktop sidebar), but the modal itself (with its auto-open when
   * detecting a new version, see ChangelogButton.tsx) must exist ONE
   * single time -- if each icon had its own local state, the two copies
   * would auto-open separately and closing one would reveal the other behind it
   * (the changelog "showed up twice"). By sharing this boolean, both
   * icons are just triggers for the same window.
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
