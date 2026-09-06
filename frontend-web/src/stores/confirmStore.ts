import type { LucideIcon } from 'lucide-react'
import { create } from 'zustand'
import i18n from '@/lib/i18n'

interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'danger'
  /** By default the confirm button's icon is derived from `variant`
   * (Trash2 for danger, Check for default) -- that makes sense for deleting
   * something, but not for every "danger" action (e.g. logging out is red but
   * doesn't delete anything). Passing this overrides that default. */
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
          title: options.title ?? i18n.t('confirmStore.defaultTitle', { ns: 'common' }),
          message: options.message,
          confirmLabel: options.confirmLabel ?? i18n.t('confirmStore.defaultConfirmLabel', { ns: 'common' }),
          cancelLabel: options.cancelLabel ?? i18n.t('confirmStore.defaultCancelLabel', { ns: 'common' }),
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
