import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { AiProposal, ApiSuccess } from '@/types'

/** Confirm or cancel what the advisor proposed. The server runs the stored items
 * itself -- all or nothing -- so the app only says yes or no; it never resends the data. */
export function useResolveProposal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'confirm' | 'cancel' }) => {
      const { data } = await api.post<ApiSuccess<AiProposal>>(`/ai/proposals/${id}/${action}`)
      return data.data
    },
    onSuccess: (proposal) => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'history'] })
      if (proposal.status === 'confirmed') {
        // Confirming creates accounts, transactions, debts...: nearly every screen
        // is out of date. Only what is on screen refetches.
        queryClient.invalidateQueries({
          predicate: (query) => query.queryKey[0] !== 'auth' && query.queryKey[0] !== 'ai',
        })
      }
    },
  })
}
