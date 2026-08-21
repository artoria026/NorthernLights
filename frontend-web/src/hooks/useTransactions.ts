import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { ApiSuccess, EntryType, Meta, Transaction } from '@/types'

export interface TransactionFilters {
  page?: number
  per_page?: number
  entry_type?: EntryType
  account_id?: string
  date_from?: string
  date_to?: string
}

export function useTransactions(filters: TransactionFilters = {}) {
  return useQuery({
    queryKey: ['transactions', filters],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<Transaction[]> & { meta: Meta }>(
        '/transactions',
        { params: filters },
      )
      return data
    },
  })
}

export interface CreateTransactionInput {
  date: string
  description: string
  notes?: string
  tags?: string[]
  entry_type: EntryType
  category_id?: string | null
  /** Forma simple (income/expense): el backend resuelve solo la cuenta
   * contable interna de la categoría, nunca la elige el usuario. */
  account_id?: string
  amount?: string
  /** Forma explícita, solo para transfer: dos cuentas reales del usuario. */
  lines?: { account_id: string; amount: string; type: 'debit' | 'credit' }[]
  /** Solo para entry_type='expense' en forma simple, pagando con una TDC:
   * marca la compra como a meses sin intereses. El backend valida la cuenta
   * y calcula el progreso al vuelo -- ver Transaction.installment. */
  installment_total?: number
}

export function useCreateTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateTransactionInput) => {
      const { data } = await api.post<ApiSuccess<Transaction>>('/transactions', input)
      return data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
  })
}

export interface SplitExpenseInput {
  date: string
  description: string
  notes?: string
  category_id: string
  paying_account_id: string
  my_share: string
  /** Se resuelve/crea solo en Deudas (direction=owed_to_me) por nombre --
   * nunca se elige una cuenta para esto. */
  debtors: { person_name: string; amount: string }[]
}

export function useCreateSplitExpense() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: SplitExpenseInput) => {
      const { data } = await api.post<ApiSuccess<Transaction>>('/transactions/split', input)
      return data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['debts'] })
    },
  })
}

export interface UpdateTransactionInput {
  date?: string
  description?: string
  notes?: string
  category_id?: string | null
  /** Forma simple (expense/income): mismo patrón que crear -- el backend
   * resuelve la cuenta contable interna, el front solo manda la cuenta real. */
  account_id?: string
  amount?: string
  /** Forma explícita, solo para transfer. */
  lines?: { account_id: string; amount: string; type: 'debit' | 'credit' }[]
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateTransactionInput }) => {
      const { data } = await api.put<ApiSuccess<Transaction>>(`/transactions/${id}`, input)
      return data.data
    },
    onSuccess: () => {
      // A diferencia de eliminar, aqui casi cualquier campo pudo cambiar
      // (fecha, monto, cuenta) -- invalidar en vez de parchear en el cliente,
      // mismo patron que useCreateTransaction.
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
  })
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/transactions/${id}`)
      return id
    },
    onSuccess: (id) => {
      // A diferencia de crear (donde el lugar correcto en el orden/paginado
      // depende de logica del servidor que no queremos duplicar en el
      // cliente), quitar una fila es seguro en cualquier pagina/filtro
      // cacheado: nunca genera ambiguedad de orden.
      const queries = queryClient.getQueryCache().findAll({ queryKey: ['transactions'] })
      for (const query of queries) {
        queryClient.setQueryData<ApiSuccess<Transaction[]> & { meta: Meta }>(
          query.queryKey,
          (old) => {
            if (!old) return old
            return {
              ...old,
              data: old.data.filter((tx) => tx.id !== id),
              meta: { ...old.meta, total: Math.max(0, old.meta.total - 1) },
            }
          },
        )
      }
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
  })
}
