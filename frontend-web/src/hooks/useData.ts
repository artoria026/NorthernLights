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
      // The blast radius of a mass deletion covers almost every domain of
      // the app -- simpler to invalidate the entire cache than to enumerate each one.
      queryClient.invalidateQueries()
    },
  })
}
