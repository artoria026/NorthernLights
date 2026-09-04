import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type {
  ApiSuccess,
  BudgetCurrent,
  BudgetLimit,
  BudgetLimitSuggestion,
  BudgetTrendMonth,
  WeeklyBudget,
} from '@/types'

export function useBudgetCurrent() {
  return useQuery({
    queryKey: ['budget', 'current'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<BudgetCurrent>>('/budget/current')
      return data.data
    },
  })
}

/** Same shape as useBudgetCurrent but for any year/month -- used
 * by the Budget page's month navigator to view past months. */
export function useBudgetForMonth(year: number, month: number) {
  return useQuery({
    queryKey: ['budget', 'month', year, month],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<BudgetCurrent>>(`/budget/${year}/${month}`)
      return data.data
    },
  })
}

export function useBudgetTrend() {
  return useQuery({
    queryKey: ['budget', 'trend'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<BudgetTrendMonth[]>>('/budget/trend')
      return data.data
    },
  })
}

export function useBudgetWeekly() {
  return useQuery({
    queryKey: ['budget', 'weekly'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<WeeklyBudget>>('/budget/current/weekly')
      return data.data
    },
  })
}

export function useBudgetLimitSuggestions() {
  return useQuery({
    queryKey: ['budget', 'limits', 'suggestions'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<BudgetLimitSuggestion[]>>('/budget/limits/suggestions')
      return data.data
    },
  })
}

/** Accepts one or several limits in the same call -- the backend does an upsert
 * per category (on_conflict_do_update), so sending 8 categories at
 * once is as safe as sending 1, and avoids 8 separate round-trips. */
export function useSetBudgetLimits() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { category_id: string; monthly_limit: string }[]) => {
      const { data } = await api.put<ApiSuccess<BudgetLimit[]>>('/budget/limits', {
        limits: input,
      })
      return data.data
    },
    onSuccess: (limits) => {
      // The PUT returns the full, authoritative set of limits -- we
      // write it directly, without waiting for a GET round-trip.
      queryClient.setQueryData(['budget', 'limits'], limits)
      // 'suggestions' carries current_limit in addition to the average -- the setQueryData
      // above doesn't touch it (it's a different query), so it's invalidated
      // instead of rewritten by hand.
      queryClient.invalidateQueries({ queryKey: ['budget', 'limits', 'suggestions'] })
      // Committed/available per category do depend on the limit -- those
      // are aggregates computed on the server.
      queryClient.invalidateQueries({ queryKey: ['budget', 'current'] })
      queryClient.invalidateQueries({ queryKey: ['budget', 'summary'] })
      queryClient.invalidateQueries({ queryKey: ['budget', 'month'] })
      queryClient.invalidateQueries({ queryKey: ['budget', 'trend'] })
    },
  })
}
