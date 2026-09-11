import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type {
  ApiSuccess,
  Debt,
  DebtDirection,
  DebtSummary,
  DebtType,
  PaymentFrequency,
  UnplannedDebt,
} from '@/types'

/** Any debt mutation can touch lists (by direction), summary,
 * upcoming payments and unplanned all at once -- simpler to invalidate all of ['debts']
 * than to maintain manual cache patches for every queryKey variant. */
function invalidateDebts(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['debts'] })
}

export function useUnplannedDebts() {
  return useQuery({
    queryKey: ['debts', 'unplanned'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<UnplannedDebt[]>>('/debts/unplanned')
      return data.data
    },
  })
}

export function useDebts(direction?: DebtDirection) {
  return useQuery({
    queryKey: ['debts', 'list', direction ?? 'all'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<Debt[]>>('/debts', { params: { direction } })
      return data.data
    },
  })
}

export function useDebtSummary() {
  return useQuery({
    queryKey: ['debts', 'summary'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<DebtSummary>>('/debts/summary')
      return data.data
    },
  })
}

export interface CreateUnplannedDebtInput {
  name: string
  creditor?: string
  amount: string
  direction: DebtDirection
  notes?: string
}

export function useCreateUnplannedDebt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateUnplannedDebtInput) => {
      const { data } = await api.post<ApiSuccess<UnplannedDebt>>('/debts/unplanned', input)
      return data.data
    },
    onSuccess: () => invalidateDebts(queryClient),
  })
}

export interface ActivateDebtInput {
  agreed_amount?: string
  payment_amount: string
  payment_frequency: PaymentFrequency
  payment_day?: number
  total_installments?: number
  linked_account_id?: string
  /** Actual account where the cash for this loan already came in/out -- the
   * unplanned debt never touches balances by design, this is the first
   * opportunity to record the real transaction. */
  funding_account_id?: string
  start_date: string
  due_date?: string
}

export function useActivateUnplannedDebt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: ActivateDebtInput }) => {
      const { data } = await api.post<ApiSuccess<Debt>>(`/debts/unplanned/${id}/activate`, input)
      return data.data
    },
    onSuccess: (_debt, { input }) => {
      invalidateDebts(queryClient)
      if (input.funding_account_id) {
        queryClient.invalidateQueries({ queryKey: ['accounts'] })
        queryClient.invalidateQueries({ queryKey: ['transactions'] })
      }
    },
  })
}

export interface CreateDebtInput {
  name: string
  creditor?: string
  type: DebtType
  direction: DebtDirection
  total_amount: string
  current_balance?: string
  interest_rate?: string
  payment_amount?: string
  payment_frequency?: PaymentFrequency
  total_installments?: number
  linked_account_id?: string
  /** Actual account where the cash for originating this debt already came in/out. */
  funding_account_id?: string
  start_date?: string
  is_shared?: boolean
  responsible_party?: string
}

export function useCreateDebt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateDebtInput) => {
      const { data } = await api.post<ApiSuccess<Debt>>('/debts', input)
      return data.data
    },
    onSuccess: (_debt, input) => {
      invalidateDebts(queryClient)
      // funding_account_id is the only case that generates a real transaction
      // -- that's when accounts/transactions actually change.
      if (input.funding_account_id) {
        queryClient.invalidateQueries({ queryKey: ['accounts'] })
        queryClient.invalidateQueries({ queryKey: ['transactions'] })
      }
    },
  })
}

export interface UpdateDebtInput {
  name?: string
  payment_amount?: string
  payment_frequency?: PaymentFrequency
  payment_day?: number
  next_payment_date?: string
  linked_account_id?: string
  payment_source_account_id?: string
  notes?: string
  /** Manual correction of the outstanding balance -- current_balance is the sole
   * source of truth for a debt's balance (unlike Account, which
   * has a separate initial_balance), so this adjusts directly, not by
   * delta. Meant for correcting the balance after a historical backfill. */
  current_balance?: string
}

/** PUT /debts/{id} (backend/app/routers/debts.py) has always existed ready
 * to go -- the only thing missing was the frontend using it. Today only
 * CorrectBalanceForm in Debts.tsx consumes it, but it works for any field of
 * DebtUpdate. */
export function useUpdateDebt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateDebtInput }) => {
      const { data } = await api.put<ApiSuccess<Debt>>(`/debts/${id}`, input)
      return data.data
    },
    onSuccess: () => invalidateDebts(queryClient),
  })
}

export interface RegisterDebtPaymentInput {
  account_id: string
  amount: string
  date: string
  notes?: string
}

export function useRegisterDebtPayment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ debtId, input }: { debtId: string; input: RegisterDebtPaymentInput }) => {
      const { data } = await api.post(`/debts/${debtId}/payments`, input)
      return data.data
    },
    onSuccess: () => {
      invalidateDebts(queryClient)
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
    },
  })
}
