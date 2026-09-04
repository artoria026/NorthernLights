import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { Account, AccountReconcileResult, AccountSummary, ApiSuccess, TdcCycle } from '@/types'

export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<Account[]>>('/accounts')
      return data.data
    },
  })
}

export function useAccountSummary() {
  return useQuery({
    queryKey: ['accounts', 'summary'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<AccountSummary>>('/accounts/summary')
      return data.data
    },
  })
}

/** Credit card cycle (statement date, payment, available credit). Only applies to
 * liability/credit_card accounts with billing_cycle_day configured -- pass `enabled`
 * as false for any other account type. */
export function useTdcCycle(accountId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['accounts', accountId, 'tdc-cycle'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<TdcCycle>>(`/accounts/tdc/${accountId}/cycle`)
      return data.data
    },
    enabled: enabled && !!accountId,
  })
}

export interface CreateAccountInput {
  name: string
  type: Account['type']
  subtype?: string | null
  last_4_digits?: string | null
  currency?: string
  color?: string
  notes?: string | null
  logo_data_url?: string | null
  initial_balance?: string
  credit_limit?: string | null
  interest_rate?: string | null
  billing_cycle_day?: number | null
  payment_due_day?: number | null
}

export function useCreateAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateAccountInput) => {
      const { data } = await api.post<ApiSuccess<Account>>('/accounts', input)
      return data.data
    },
    onSuccess: (account) => {
      // We write the account directly into the cache instead of just invalidating:
      // invalidating forces a network round-trip before the list
      // updates, which on slow connections feels like it "doesn't show up".
      // We already have the full object returned by the POST, no need to fetch it again.
      queryClient.setQueryData<Account[]>(['accounts'], (prev) => [...(prev ?? []), account])
      queryClient.invalidateQueries({ queryKey: ['accounts', 'summary'] })
    },
  })
}

export interface UpdateAccountInput {
  name?: string
  last_4_digits?: string | null
  currency?: string
  color?: string
  notes?: string | null
  logo_data_url?: string | null
  /** Editable even if there are already transactions -- the backend adjusts `balance`
   * by the same delta. Warning/confirming before sending this if the account
   * already has transactions is the form's responsibility (see Accounts.tsx). */
  initial_balance?: string
  credit_limit?: string | null
  interest_rate?: string | null
  billing_cycle_day?: number | null
  payment_due_day?: number | null
}

export function useUpdateAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateAccountInput }) => {
      const { data } = await api.put<ApiSuccess<Account>>(`/accounts/${id}`, input)
      return data.data
    },
    onSuccess: (account) => {
      queryClient.setQueryData<Account[]>(['accounts'], (prev) =>
        (prev ?? []).map((a) => (a.id === account.id ? account : a)),
      )
      queryClient.invalidateQueries({ queryKey: ['accounts', 'summary'] })
    },
  })
}

export interface ReconcileAccountInput {
  real_balance: string
  date?: string
  notes?: string
}

/** Balance reconciliation: if `real_balance` differs from the balance the app
 * already calculates, the backend creates an adjustment transaction (adjustment_in/out)
 * and returns the result -- if they match, `adjusted: false` and nothing was created.
 * Invalidates accounts/transactions/reports because an actual reconciliation
 * affects all three (unlike a simple account rename). */
export function useReconcileAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: ReconcileAccountInput }) => {
      const { data } = await api.post<ApiSuccess<AccountReconcileResult>>(
        `/accounts/${id}/reconcile`,
        input,
      )
      return data.data
    },
    onSuccess: (result) => {
      if (!result.adjusted) return
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['reports'] })
      queryClient.invalidateQueries({ queryKey: ['budget'] })
    },
  })
}

export function useDeleteAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/accounts/${id}`)
      return id
    },
    onSuccess: (id) => {
      queryClient.setQueryData<Account[]>(['accounts'], (prev) => (prev ?? []).filter((a) => a.id !== id))
      queryClient.invalidateQueries({ queryKey: ['accounts', 'summary'] })
    },
  })
}
