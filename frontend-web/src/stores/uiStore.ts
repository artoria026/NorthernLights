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
}

let nextId = 1

export const useUiStore = create<UiState>((set) => ({
  toasts: [],
  pushToast: (message, variant = 'error') =>
    set((state) => ({ toasts: [...state.toasts, { id: nextId++, message, variant }] })),
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}))
