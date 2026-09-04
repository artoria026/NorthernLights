import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { ApiSuccess } from '@/types'

export type FeedbackType = 'bug' | 'feature'
export type FeedbackStatus = 'new' | 'read' | 'considered' | 'discarded'

export interface AdminFeedback {
  id: string
  user_id: string
  user_name: string
  user_email: string
  type: FeedbackType
  message: string
  status: FeedbackStatus
  admin_note: string | null
  created_at: string
  updated_at: string
}

/** Report a bug or suggest a feature -- see ChangelogButton.tsx, it's the
 * only place in the app that sends this for now. */
export function useCreateFeedback() {
  return useMutation({
    mutationFn: async (input: { type: FeedbackType; message: string }) => {
      const { data } = await api.post<ApiSuccess<{ id: string }>>('/feedback', input)
      return data.data
    },
  })
}

export function useAdminFeedback(status?: FeedbackStatus) {
  return useQuery({
    queryKey: ['admin', 'feedback', status ?? 'all'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<AdminFeedback[]>>('/admin/feedback', {
        params: status ? { status } : undefined,
      })
      return data.data
    },
  })
}

export function useUpdateFeedbackStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      status,
      adminNote,
    }: {
      id: string
      status: FeedbackStatus
      adminNote?: string
    }) => {
      const { data } = await api.patch<
        ApiSuccess<{ id: string; status: FeedbackStatus; admin_note: string | null }>
      >(`/admin/feedback/${id}/status`, { status, admin_note: adminNote })
      return data.data
    },
    onSuccess: (result) => {
      queryClient.setQueriesData<AdminFeedback[]>({ queryKey: ['admin', 'feedback'] }, (prev) =>
        prev?.map((f) =>
          f.id === result.id ? { ...f, status: result.status, admin_note: result.admin_note } : f,
        ),
      )
    },
  })
}
