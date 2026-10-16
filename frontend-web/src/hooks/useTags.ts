import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { ApiSuccess, Tag, TagSummary, TagWithStats } from '@/types'

export function useTags() {
  return useQuery({
    queryKey: ['tags', 'list'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<TagWithStats[]>>('/tags')
      return data.data
    },
  })
}

export function useTagSummary(tagId: string | null, range: { date_from?: string; date_to?: string } = {}) {
  return useQuery({
    queryKey: ['tags', 'summary', tagId, range],
    enabled: !!tagId,
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<TagSummary>>(`/tags/${tagId}/summary`, {
        params: { date_from: range.date_from || undefined, date_to: range.date_to || undefined },
      })
      return data.data
    },
  })
}

export function useCreateTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; color?: string }) => {
      const { data } = await api.post<ApiSuccess<Tag>>('/tags', input)
      return data.data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tags'] }),
  })
}

export function useUpdateTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...input }: { id: string; name?: string; color?: string }) => {
      const { data } = await api.patch<ApiSuccess<Tag>>(`/tags/${id}`, input)
      return data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
    },
  })
}

export function useDeleteTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/tags/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
    },
  })
}

/** Add and/or remove tags on many expenses at once (all or nothing). */
export function useBulkTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { transaction_ids: string[]; add_tag_ids?: string[]; remove_tag_ids?: string[] }) => {
      const { data } = await api.post<ApiSuccess<{ updated: number }>>('/tags/bulk', input)
      return data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
    },
  })
}
