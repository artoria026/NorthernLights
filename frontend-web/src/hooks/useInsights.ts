import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { ApiSuccess, Insight, InsightReview } from '@/types'

function invalidateInsights(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['insights'] })
}

export function useInsights() {
  return useQuery({
    queryKey: ['insights', 'active'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<Insight[]>>('/insights')
      return data.data
    },
  })
}

export function useInsightHistory(page = 1, perPage = 20) {
  return useQuery({
    queryKey: ['insights', 'history', page, perPage],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<Insight[]>>('/insights/history', {
        params: { page, per_page: perPage },
      })
      return { items: data.data, meta: data.meta }
    },
  })
}

export function useInsightReviews(insightId: string | null) {
  return useQuery({
    queryKey: ['insights', 'reviews', insightId],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<InsightReview[]>>(
        `/insights/${insightId}/reviews`,
      )
      return data.data
    },
    enabled: !!insightId,
  })
}

export function useGenerateInsights() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<ApiSuccess<Insight[]>>('/insights/generate')
      return data.data
    },
    onSuccess: () => invalidateInsights(queryClient),
  })
}

export function useDismissInsight() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.patch<ApiSuccess<Insight>>(`/insights/${id}/dismiss`)
      return data.data
    },
    onSuccess: (insight) => {
      // Un insight descartado ya no es "activo" -- sacarlo de la lista visible
      // al instante. El historial paginado (donde ahora aparece) se refresca
      // aparte, no bloquea el feedback de "ya lo descarte".
      queryClient.setQueryData<Insight[]>(['insights', 'active'], (prev) =>
        (prev ?? []).filter((i) => i.id !== insight.id),
      )
      queryClient.invalidateQueries({ queryKey: ['insights', 'history'] })
    },
  })
}

export function useResolveInsight() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.patch<ApiSuccess<Insight>>(`/insights/${id}/resolve`)
      return data.data
    },
    onSuccess: (insight) => {
      queryClient.setQueryData<Insight[]>(['insights', 'active'], (prev) =>
        (prev ?? []).filter((i) => i.id !== insight.id),
      )
      queryClient.invalidateQueries({ queryKey: ['insights', 'history'] })
    },
  })
}
