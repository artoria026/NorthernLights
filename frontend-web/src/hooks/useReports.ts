import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { ApiSuccess, Report, ReportSummary } from '@/types'

function invalidateReports(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['reports'] })
}

export function useReports(page = 1, perPage = 20) {
  return useQuery({
    queryKey: ['reports', 'list', page, perPage],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<Report[]>>('/reports', {
        params: { page, per_page: perPage },
      })
      return { items: data.data, meta: data.meta }
    },
  })
}

export function useCurrentMonthSummary() {
  return useQuery({
    queryKey: ['reports', 'current'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<ReportSummary>>('/reports/summary/current')
      return data.data
    },
  })
}

export interface GenerateReportInput {
  period_start?: string
  period_end?: string
  /** Recalcula desde cero un periodo que ya tiene un reporte listo -- para
   * cuando el usuario backfillea historial viejo y el mes/año ya se habia
   * generado (casi vacio) antes de cargar esas transacciones. */
  force?: boolean
}

export function useGenerateReport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: GenerateReportInput = {}) => {
      const { data } = await api.post<ApiSuccess<Report>>('/reports/generate', input)
      return data.data
    },
    onSuccess: () => invalidateReports(queryClient),
  })
}

export interface GenerateYearlyReportInput {
  year: number
  force?: boolean
}

export function useGenerateYearlyReport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ year, force }: GenerateYearlyReportInput) => {
      const { data } = await api.post<ApiSuccess<Report>>('/reports/generate', { year, force })
      return data.data
    },
    onSuccess: () => invalidateReports(queryClient),
  })
}
