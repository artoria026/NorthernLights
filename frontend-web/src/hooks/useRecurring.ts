import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import { patchAllListQueries, patchMatchingListQueries } from '@/lib/queryCache'
import type {
  AlertUrgency,
  ApiSuccess,
  RecurringFrequency,
  RecurringItem,
  RecurringItemType,
} from '@/types'

function invalidateRecurring(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['recurring'] })
  queryClient.invalidateQueries({ queryKey: ['transactions'] })
  queryClient.invalidateQueries({ queryKey: ['budget'] })
}

/** `['recurring', 'list', status, item_type]` puede tener varias variantes
 * cacheadas a la vez (distintos filtros montados en distintas vistas) -- solo
 * insertamos el item nuevo en las que su status/item_type realmente incluiria. */
function matchesRecurringFilter(queryKey: unknown[], item: RecurringItem): boolean {
  const [, , status, itemType] = queryKey
  const statusOk = status === 'all' || status === item.status
  const typeOk = itemType === 'all' || itemType === item.item_type
  return statusOk && typeOk
}

export function useRecurringItems(filters?: { status?: string; item_type?: string }) {
  return useQuery({
    queryKey: ['recurring', 'list', filters?.status ?? 'all', filters?.item_type ?? 'all'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<RecurringItem[]>>('/recurring-items', {
        params: filters,
      })
      return data.data
    },
  })
}

export function useUpcomingRecurring(daysAhead = 7) {
  return useQuery({
    queryKey: ['recurring', 'upcoming', daysAhead],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<RecurringItem[]>>('/recurring-items/upcoming', {
        params: { days_ahead: daysAhead },
      })
      return data.data
    },
  })
}

export function usePendingRecurring() {
  return useQuery({
    queryKey: ['recurring', 'pending'],
    queryFn: async () => {
      const { data } = await api.get('/recurring-items/pending')
      return data.data
    },
  })
}

export interface CreateRecurringItemInput {
  name: string
  description?: string
  item_type: RecurringItemType
  amount: string
  frequency: RecurringFrequency
  account_id: string
  category_id: string
  alert_urgency?: AlertUrgency
  auto_generate?: boolean
  next_date: string
  notes?: string
  url?: string
}

export function useCreateRecurringItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateRecurringItemInput) => {
      const { data } = await api.post<ApiSuccess<RecurringItem>>('/recurring-items', input)
      return data.data
    },
    onSuccess: (item) => {
      // Solo crea el registro (M06); la primera transaccion real la genera
      // Celery despues -- no hay balances/budget que recalcular todavia.
      patchMatchingListQueries<RecurringItem>(
        queryClient,
        ['recurring', 'list'],
        (key) => matchesRecurringFilter(key as unknown[], item),
        (prev) => [...(prev ?? []), item],
      )
      queryClient.invalidateQueries({ queryKey: ['recurring', 'summary'] })
    },
  })
}

export interface UpdateRecurringItemInput {
  name?: string
  amount?: string
  frequency?: RecurringFrequency
  account_id?: string
  category_id?: string
  alert_urgency?: AlertUrgency
  next_date?: string
}

/** item_type y status no son editables aqui (item_type define categorias
 * validas/entry_type y no se puede migrar; status tiene sus propios
 * endpoints dedicados: pause/cancel/resume) -- por eso nunca cambia el
 * bucket de status/item_type de un item existente y matchesRecurringFilter
 * no necesita revisarse tras un update, a diferencia de un create. */
export function useUpdateRecurringItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateRecurringItemInput }) => {
      const { data } = await api.put<ApiSuccess<RecurringItem>>(`/recurring-items/${id}`, input)
      return data.data
    },
    onSuccess: (item) => {
      patchAllListQueries<RecurringItem>(queryClient, ['recurring', 'list'], (prev) =>
        (prev ?? []).map((i) => (i.id === item.id ? item : i)),
      )
      queryClient.invalidateQueries({ queryKey: ['recurring', 'upcoming'] })
      invalidateRecurring(queryClient)
    },
  })
}

export function usePauseRecurringItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.patch<ApiSuccess<RecurringItem>>(`/recurring-items/${id}/pause`)
      return data.data
    },
    onSuccess: (item) => {
      // Actualiza el status donde ya esta visible al instante; invalida
      // ademas para que las variantes filtradas por status lo saquen/metan
      // de la lista correcta en su proximo refetch.
      patchAllListQueries<RecurringItem>(queryClient, ['recurring', 'list'], (prev) =>
        (prev ?? []).map((i) => (i.id === item.id ? item : i)),
      )
      invalidateRecurring(queryClient)
    },
  })
}

export function useCancelRecurringItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.patch<ApiSuccess<RecurringItem>>(`/recurring-items/${id}/cancel`)
      return data.data
    },
    onSuccess: (item) => {
      patchAllListQueries<RecurringItem>(queryClient, ['recurring', 'list'], (prev) =>
        (prev ?? []).map((i) => (i.id === item.id ? item : i)),
      )
      invalidateRecurring(queryClient)
    },
  })
}

export function useResumeRecurringItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.patch<ApiSuccess<RecurringItem>>(`/recurring-items/${id}/resume`)
      return data.data
    },
    onSuccess: (item) => {
      patchAllListQueries<RecurringItem>(queryClient, ['recurring', 'list'], (prev) =>
        (prev ?? []).map((i) => (i.id === item.id ? item : i)),
      )
      invalidateRecurring(queryClient)
    },
  })
}

export function useConfirmTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (entryId: string) => {
      const { data } = await api.post(`/transactions/${entryId}/confirm`)
      return data.data
    },
    onSuccess: (_, entryId) => {
      // Confirmar crea una transaccion real (afecta balances/presupuesto) --
      // eso si necesita recalculo del servidor. Lo que puede quitarse al
      // instante es el draft de la lista de pendientes.
      queryClient.setQueryData(['recurring', 'pending'], (prev: unknown) =>
        Array.isArray(prev) ? prev.filter((tx: { id: string }) => tx.id !== entryId) : prev,
      )
      invalidateRecurring(queryClient)
    },
  })
}

export function useRejectTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (entryId: string) => {
      const { data } = await api.post(`/transactions/${entryId}/reject`)
      return data.data
    },
    onSuccess: (_, entryId) => {
      queryClient.setQueryData(['recurring', 'pending'], (prev: unknown) =>
        Array.isArray(prev) ? prev.filter((tx: { id: string }) => tx.id !== entryId) : prev,
      )
      invalidateRecurring(queryClient)
    },
  })
}
