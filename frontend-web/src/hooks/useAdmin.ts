import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { ApiSuccess } from '@/types'

export interface AdminUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'user'
  auth_provider: string
  is_active: boolean
  created_at: string
  accounts_count: number
  transactions_count: number
  last_active_at: string | null
  health_score: number
}

export interface SignupDay {
  date: string
  count: number
}

export interface AdminStats {
  total_users: number
  active_users: number
  admin_users: number
  new_users_last_7_days: number
  total_accounts: number
  total_transactions: number
  total_debts: number
  google_users: number
  users_with_accounts: number
  users_with_debts: number
  users_with_recurring: number
  inactive_users_30d: number
  ai_queries_today: number
  feedback_new_count: number
  signups_last_14_days: SignupDay[]
}

export function useAdminUsers(page = 1, perPage = 20, search = '') {
  return useQuery({
    queryKey: ['admin', 'users', page, perPage, search],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<AdminUser[]>>('/admin/users', {
        params: { page, per_page: perPage, search: search || undefined },
      })
      return { items: data.data, meta: data.meta }
    },
  })
}

export function useAdminStats() {
  return useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<AdminStats>>('/admin/stats')
      return data.data
    },
  })
}

function patchUser(queryClient: ReturnType<typeof useQueryClient>, user: Partial<AdminUser> & { id: string }) {
  queryClient.setQueriesData<{ items: AdminUser[]; meta: unknown }>(
    { queryKey: ['admin', 'users'] },
    (prev) =>
      prev && {
        ...prev,
        items: prev.items.map((u) => (u.id === user.id ? { ...u, ...user } : u)),
      },
  )
}

export function useSetUserActive() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { data } = await api.patch<ApiSuccess<{ id: string; is_active: boolean }>>(
        `/admin/users/${id}/active`,
        { is_active },
      )
      return data.data
    },
    onSuccess: (result) => patchUser(queryClient, result),
  })
}

export function useSetUserRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, role }: { id: string; role: 'admin' | 'user' }) => {
      const { data } = await api.patch<ApiSuccess<{ id: string; role: string }>>(
        `/admin/users/${id}/role`,
        { role },
      )
      return data.data
    },
    onSuccess: (result) => patchUser(queryClient, result as Partial<AdminUser> & { id: string }),
  })
}

// Sin onSuccess que toque la cache de usuarios -- el reset no cambia ningun
// campo que la tabla muestre, solo el password_hash (que nunca llega al
// front salvo el valor temporal en texto plano de esta unica respuesta).
export function useResetUserPassword() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<ApiSuccess<{ temporary_password: string }>>(
        `/admin/users/${id}/reset-password`,
      )
      return data.data
    },
  })
}
