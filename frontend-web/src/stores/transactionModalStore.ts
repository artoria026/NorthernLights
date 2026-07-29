import { create } from 'zustand'

interface TransactionModalState {
  modal: 'quick' | 'detailed' | null
  defaultAccountId?: string
  openQuick: () => void
  openDetailed: (accountId?: string) => void
  switchToDetailed: () => void
  close: () => void
}

export const useTransactionModalStore = create<TransactionModalState>((set) => ({
  modal: null,
  defaultAccountId: undefined,
  openQuick: () => set({ modal: 'quick', defaultAccountId: undefined }),
  openDetailed: (accountId) => set({ modal: 'detailed', defaultAccountId: accountId }),
  switchToDetailed: () => set({ modal: 'detailed' }),
  close: () => set({ modal: null, defaultAccountId: undefined }),
}))
