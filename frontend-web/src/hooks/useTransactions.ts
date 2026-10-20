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
  /** Only expenses carrying ANY of these tags. */
  tag_ids?: string[]
}

export function useTransactions(filters: TransactionFilters = {}) {
  return useQuery({
    queryKey: ['transactions', filters],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<Transaction[]> & { meta: Meta }>(
        '/transactions',
        { params: { ...filters, tag_ids: filters.tag_ids?.length ? filters.tag_ids.join(',') : undefined } },
      )
      return data
    },
  })
}

const ALL_PAGE_SIZE = 500 // the most the API gives per page
const ALL_MAX_PAGES = 40 // safety net: 20,000 transactions

/** EVERY transaction of the user, not just the latest page: the API caps a page at 500, so
 * this reads the first one and then fetches the rest in parallel. The Transactions screen
 * filters and totals on the client, so anything short of "all of them" would make its totals
 * (and the older rows) silently incomplete. Same `{ data, meta }` shape as `useTransactions`,
 * and under the same ['transactions'] key so every create/update/delete refreshes it. */
export function useAllTransactions() {
  return useQuery({
    queryKey: ['transactions', 'all'],
    queryFn: async () => {
      const fetchPage = async (page: number) => {
        const { data } = await api.get<ApiSuccess<Transaction[]> & { meta: Meta }>('/transactions', {
          params: { page, per_page: ALL_PAGE_SIZE },
        })
        return data
      }
      const first = await fetchPage(1)
      const pages = Math.min(ALL_MAX_PAGES, Math.ceil(first.meta.total / ALL_PAGE_SIZE))
      const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => fetchPage(i + 2)))
      return {
        ...first,
        data: [first, ...rest].flatMap((page) => page.data),
        meta: { ...first.meta, page: 1, per_page: first.meta.total },
      }
    },
  })
}

export interface CreateTransactionInput {
  date: string
  description: string
  notes?: string
  tag_ids?: string[]
  entry_type: EntryType
  category_id?: string | null
  /** Simple form (income/expense): the backend resolves only the category's
   * internal accounting account, the user never chooses it. */
  account_id?: string
  amount?: string
  /** Explicit form, transfer only: two real accounts of the user. */
  lines?: { account_id: string; amount: string; type: 'debit' | 'credit' }[]
  /** Only for entry_type='expense' in simple form, paying with a credit card:
   * marks the purchase as interest-free installments (Meses Sin Intereses). The backend validates the account
   * and computes progress on the fly -- see Transaction.installment. */
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
  /** Resolved/created only in Debts (direction=owed_to_me) by name --
   * an account is never chosen for this. */
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
  /** Replaces the transaction's tags; omit to leave them as they are. */
  tag_ids?: string[]
  category_id?: string | null
  /** Simple form (expense/income): same pattern as create -- the backend
   * resolves the internal accounting account, the front end only sends the real account. */
  account_id?: string
  amount?: string
  /** Explicit form, transfer only. */
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
      // Unlike deleting, here almost any field could have changed
      // (date, amount, account) -- invalidate instead of patching on the client,
      // same pattern as useCreateTransaction.
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
      // Unlike creating (where the correct spot in the order/pagination
      // depends on server logic we don't want to duplicate on the
      // client), removing a row is safe in any cached page/filter:
      // it never creates ordering ambiguity.
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
