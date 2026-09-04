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

/** `['recurring', 'list', status, item_type]` can have several variants
 * cached at once (different filters mounted in different views) -- we only
 * insert the new item into the ones whose status/item_type would actually include it. */
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
      // Only creates the record (M06); the first real transaction is generated
      // by Celery later -- there are no balances/budget to recalculate yet.
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

/** item_type and status are not editable here (item_type defines valid
 * categories/entry_type and can't be migrated; status has its own
 * dedicated endpoints: pause/cancel/resume) -- that's why an existing item's
 * status/item_type bucket never changes and matchesRecurringFilter
 * doesn't need to be re-checked after an update, unlike a create. */
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
      // Updates the status where it's already visible instantly; also
      // invalidates so that variants filtered by status remove/add it
      // to the correct list on their next refetch.
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
      // Confirming creates a real transaction (affects balances/budget) --
      // that does need server recalculation. What can be removed
      // instantly is the draft from the pending list.
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
