import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import type { AiUsage, ApiSuccess, ChatMessage } from '@/types'

export function useAiHistory(page = 1, perPage = 20) {
  return useQuery({
    queryKey: ['ai', 'history', page, perPage],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<ChatMessage[]>>('/ai/history', {
        params: { page, per_page: perPage },
      })
      return { items: data.data, meta: data.meta }
    },
  })
}

export function useAiUsage() {
  return useQuery({
    queryKey: ['ai', 'usage'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<AiUsage>>('/ai/usage')
      return data.data
    },
  })
}

export function useClearAiHistory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await api.delete('/ai/history')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai', 'history'] }),
  })
}

export interface StreamingChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** Names only, for the "attachment" chip in the bubble -- the PDFs themselves
   * are never persisted (see ChatAttachments), so this doesn't survive
   * a reload either: it's a convenience for the current session, not real history. */
  attachmentNames?: string[]
  /** Filled in after the stream ends (see the fetch to /ai/history
   * in sendMessage's finally) -- if it carries any of WRITE_TOOLS, this
   * response actually recorded something, it's not just text proposing it. */
  toolCalls?: { tool: string; result: unknown }[]
}

export interface SavedInsightRef {
  id: string
  title: string
}

export interface ChatAttachments {
  /** PDF account statements -- sent as-is, the backend strips the password
   * before passing them to the model (they're never persisted). */
  files: File[]
  password?: string
}

export function useChatStream() {
  const [messages, setMessages] = useState<StreamingChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedInsight, setSavedInsight] = useState<SavedInsightRef | null>(null)
  const queryClient = useQueryClient()
  // Stores the last message that actually failed (network exception or SSE
  // {error} payload, e.g. daily limit) so it can be retried as-is without
  // the user having to rewrite it. Cleared as soon as an attempt
  // finishes without errors.
  const lastFailedMessageRef = useRef<string | null>(null)

  const sendMessage = useCallback(
    async (message: string, attachments?: ChatAttachments) => {
      setError(null)
      setSavedInsight(null)
      const attachmentNames = attachments?.files.length ? attachments.files.map((f) => f.name) : undefined
      // What's shown in the bubble (clean message + attachment chip) and
      // what actually travels to the backend are no longer the same string -- the
      // network one gets the file name appended as text so the
      // history saved on the server keeps that context even though
      // the chips (attachmentNames) aren't persisted.
      const displayMessage = message || (attachmentNames ? 'Aquí están mis estados de cuenta.' : '')
      const networkMessage = attachmentNames
        ? `${displayMessage} (adjunto: ${attachmentNames.join(', ')})`
        : displayMessage
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: displayMessage, attachmentNames },
        { role: 'assistant', content: '' },
      ])
      setIsStreaming(true)

      const token = useAuthStore.getState().accessToken
      let hadError = false

      try {
        // multipart/form-data always (not only when there are attachments): the
        // endpoint no longer accepts JSON, see backend/app/routers/ai.py. The
        // browser sets the Content-Type with the boundary on its own.
        const form = new FormData()
        form.append('message', networkMessage)
        if (attachments?.password) form.append('pdf_password', attachments.password)
        for (const file of attachments?.files ?? []) form.append('attachments', file)

        const response = await fetch(`${api.defaults.baseURL}/ai/chat`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: form,
        })
        if (!response.body) throw new Error('El servidor no soporta streaming')
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          throw new Error(body?.error ?? 'No se pudo enviar el mensaje')
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          const chunks = buffer.split('\n\n')
          buffer = chunks.pop() ?? ''

          for (const chunk of chunks) {
            if (!chunk.startsWith('data: ')) continue
            const payload = chunk.slice(6)
            if (payload === '[DONE]') continue

            const parsed = JSON.parse(payload) as { text?: string; error?: string }
            if (parsed.error) {
              setError(parsed.error)
              hadError = true
            } else if (parsed.text) {
              setMessages((prev) => {
                const next = [...prev]
                const last = next[next.length - 1]
                next[next.length - 1] = { ...last, content: last.content + parsed.text }
                return next
              })
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error de conexión con el asesor')
        hadError = true
      } finally {
        setIsStreaming(false)
        lastFailedMessageRef.current = hadError ? message : null
        queryClient.invalidateQueries({ queryKey: ['ai', 'history'] })
        queryClient.invalidateQueries({ queryKey: ['ai', 'usage'] })
        queryClient.invalidateQueries({ queryKey: ['insights'] })

        if (!hadError) {
          try {
            const { data } = await api.get<ApiSuccess<ChatMessage[]>>('/ai/history', {
              params: { page: 1, per_page: 1 },
            })
            const toolCalls = data.data[0]?.tool_calls ?? undefined
            // Attaches the real tool_calls (create_transaction, create_account,
            // etc.) to the assistant message that just finished
            // streaming -- the SSE stream only sends text, this is the only thing
            // that tells the UI "something was actually recorded here" instead of
            // guessing from the wording of the text.
            if (toolCalls) {
              setMessages((prev) => {
                const next = [...prev]
                const last = next[next.length - 1]
                if (last?.role === 'assistant') next[next.length - 1] = { ...last, toolCalls }
                return next
              })
            }
            const created = toolCalls?.find((call) => call.tool === 'create_insight')
            const result = created?.result as { insight_id?: string | null; title?: string } | undefined
            if (result?.insight_id) {
              setSavedInsight({ id: result.insight_id, title: result.title ?? '' })
            }
          } catch {
            // Best-effort: if this fails it doesn't affect the chat itself.
          }
        }
      }
    },
    [queryClient],
  )

  const retryLast = useCallback(() => {
    if (!lastFailedMessageRef.current || isStreaming) return
    const message = lastFailedMessageRef.current
    // Removes the (user, empty assistant) pair from the failed attempt before
    // resending it -- sendMessage already adds its own new pair.
    setMessages((prev) => prev.slice(0, -2))
    void sendMessage(message)
  }, [isStreaming, sendMessage])

  return {
    messages,
    setMessages,
    sendMessage,
    isStreaming,
    error,
    canRetry: !!lastFailedMessageRef.current,
    retryLast,
    savedInsight,
  }
}
