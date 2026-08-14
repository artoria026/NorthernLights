import type { LucideIcon } from 'lucide-react'
import { create } from 'zustand'

interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'danger'
  /** Por defecto el icono del boton de confirmar sale segun `variant`
   * (Trash2 en danger, Check en default) -- eso tiene sentido para borrar
   * algo, pero no para toda accion "danger" (ej. cerrar sesion es roja pero
   * no borra nada). Pasar esto pisa ese default. */
  icon?: LucideIcon
}

interface ConfirmRequest {
  id: number
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  variant: 'default' | 'danger'
  icon?: LucideIcon
  resolve: (value: boolean) => void
}

interface ConfirmState {
  request: ConfirmRequest | null
  ask: (options: ConfirmOptions) => Promise<boolean>
  settle: (value: boolean) => void
}

let nextId = 1

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,
  ask: (options) =>
    new Promise<boolean>((resolve) => {
      set({
        request: {
          id: nextId++,
          title: options.title ?? 'Confirmar',
          message: options.message,
          confirmLabel: options.confirmLabel ?? 'Confirmar',
          cancelLabel: options.cancelLabel ?? 'Cancelar',
          variant: options.variant ?? 'default',
          icon: options.icon,
          resolve,
        },
      })
    }),
  settle: (value) => {
    const { request } = get()
    if (!request) return
    request.resolve(value)
    set({ request: null })
  },
}))
