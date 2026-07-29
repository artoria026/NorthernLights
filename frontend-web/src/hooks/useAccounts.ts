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

/** Ciclo de TDC (corte, pago, credito disponible). Solo aplica a cuentas
 * liability/credit_card con billing_cycle_day configurado -- pasar `enabled`
 * en false para cualquier otro tipo de cuenta. */
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
      // Escribimos la cuenta directo en la cache en vez de solo invalidar:
      // invalidar fuerza un round-trip de red antes de que la lista se
      // actualice, lo que en conexiones lentas se siente como que "no aparece".
      // Ya tenemos el objeto completo que devolvio el POST, no hace falta pedirlo de nuevo.
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
  /** Editable aunque ya haya transacciones -- el backend ajusta `balance`
   * por el mismo delta. Advertir/confirmar antes de mandar esto si la cuenta
   * ya tiene movimientos es responsabilidad del formulario (ver Accounts.tsx). */
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

/** Conciliacion de saldo: si `real_balance` difiere del saldo que la app ya
 * calcula, el backend crea una transaccion de ajuste (adjustment_in/out) y
 * devuelve el resultado -- si coinciden, `adjusted: false` y no se creo nada.
 * Invalida cuentas/transacciones/reportes porque una conciliacion real
 * afecta los tres (a diferencia de un simple rename de cuenta). */
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
