import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { ApiSuccess, Notification } from '@/types'

function invalidateNotifications(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['notifications'] })
}

export function useNotifications(page = 1, perPage = 20) {
  return useQuery({
    queryKey: ['notifications', 'list', page, perPage],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<Notification[]>>('/notifications', {
        params: { page, per_page: perPage },
      })
      return { items: data.data, meta: data.meta }
    },
  })
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<{ unread_count: number }>>(
        '/notifications/unread-count',
      )
      return data.data.unread_count
    },
    refetchInterval: 60_000,
  })
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.patch<ApiSuccess<Notification>>(`/notifications/${id}/read`)
      return data.data
    },
    onSuccess: () => invalidateNotifications(queryClient),
  })
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await api.patch('/notifications/read-all')
    },
    onSuccess: () => invalidateNotifications(queryClient),
  })
}
