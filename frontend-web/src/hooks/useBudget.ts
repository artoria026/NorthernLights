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

/** Mismo shape que useBudgetCurrent pero para cualquier year/month -- usado
 * por el navegador de meses de Presupuesto para ver meses pasados. */
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

/** Acepta uno o varios limites en la misma llamada -- el backend hace upsert
 * por categoria (on_conflict_do_update), asi que mandar 8 categorias de una
 * sola vez es tan seguro como mandar 1, y evita 8 round-trips separados. */
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
      // El PUT devuelve el set completo y autoritativo de limites -- lo
      // escribimos directo, sin esperar un GET de vuelta.
      queryClient.setQueryData(['budget', 'limits'], limits)
      // 'suggestions' trae current_limit ademas del promedio -- setQueryData
      // arriba no lo toca (es una query distinta), asi que se invalida en
      // vez de reescribir a mano.
      queryClient.invalidateQueries({ queryKey: ['budget', 'limits', 'suggestions'] })
      // Comprometido/disponible por categoria si dependen del limite -- esos
      // si son agregados calculados en el servidor.
      queryClient.invalidateQueries({ queryKey: ['budget', 'current'] })
      queryClient.invalidateQueries({ queryKey: ['budget', 'summary'] })
      queryClient.invalidateQueries({ queryKey: ['budget', 'month'] })
      queryClient.invalidateQueries({ queryKey: ['budget', 'trend'] })
    },
  })
}
