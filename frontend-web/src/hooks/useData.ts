import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { ApiSuccess } from '@/types'

export type DataCategory =
  | 'transactions'
  | 'debts'
  | 'recurring'
  | 'budgets'
  | 'insights'
  | 'reports'
  | 'notifications'
  | 'chat'
  | 'categories'
  | 'accounts'

export interface EraseDataInput {
  categories: DataCategory[]
  password?: string
}

export function useEraseData() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: EraseDataInput) => {
      const { data } = await api.post<ApiSuccess<{ erased: DataCategory[] }>>(
        '/data/erase',
        input,
      )
      return data.data
    },
    onSuccess: () => {
      // El blast radius de un borrado masivo cubre casi cualquier dominio de
      // la app -- mas simple invalidar todo el cache que enumerar cada uno.
      queryClient.invalidateQueries()
    },
  })
}
