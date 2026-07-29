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
  /** Solo nombres, para el chip de "adjunto" en la burbuja -- los PDFs en si
   * nunca se persisten (ver ChatAttachments), asi que esto tampoco sobrevive
   * un reload: es una comodidad de la sesion actual, no historial real. */
  attachmentNames?: string[]
  /** Se llena despues de que el stream termina (ver el fetch a /ai/history
   * en el finally de sendMessage) -- si trae alguna de WRITE_TOOLS, esta
   * respuesta de verdad registro algo, no es solo texto proponiendolo. */
  toolCalls?: { tool: string; result: unknown }[]
}

export interface SavedInsightRef {
  id: string
  title: string
}

export interface ChatAttachments {
  /** Estados de cuenta en PDF -- se mandan tal cual, el backend les quita la
   * contraseña antes de pasarlos al modelo (nunca se persisten). */
  files: File[]
  password?: string
}

export function useChatStream() {
  const [messages, setMessages] = useState<StreamingChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedInsight, setSavedInsight] = useState<SavedInsightRef | null>(null)
  const queryClient = useQueryClient()
  // Guarda el ultimo mensaje que de verdad fallo (excepcion de red o payload
  // {error} del SSE, ej. limite diario) para poder reintentarlo tal cual sin
  // que el usuario tenga que reescribirlo. Se limpia en cuanto un intento
  // termina sin errores.
  const lastFailedMessageRef = useRef<string | null>(null)

  const sendMessage = useCallback(
    async (message: string, attachments?: ChatAttachments) => {
      setError(null)
      setSavedInsight(null)
      const attachmentNames = attachments?.files.length ? attachments.files.map((f) => f.name) : undefined
      // Lo que se ve en la burbuja (mensaje limpio + chip de adjuntos) y lo
      // que de verdad viaja al backend ya no son el mismo string -- al de
      // red se le agrega el nombre del archivo en texto para que el
      // historial guardado en el server siga teniendo ese contexto aunque
      // los chips (attachmentNames) no se persistan.
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
        // multipart/form-data siempre (no solo cuando hay adjuntos): el
        // endpoint ya no acepta JSON, ver backend/app/routers/ai.py. El
        // browser pone el Content-Type con el boundary solo.
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
            // Le pega los tool_calls reales (create_transaction, create_account,
            // etc.) al mensaje del asistente que se acaba de terminar de
            // transmitir -- el stream de SSE solo manda texto, esto es lo unico
            // que le dice a la UI "aqui de verdad se registro algo" en vez de
            // adivinar por palabras del texto.
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
            // Best-effort: si esto falla no afecta el chat en si.
          }
        }
      }
    },
    [queryClient],
  )

  const retryLast = useCallback(() => {
    if (!lastFailedMessageRef.current || isStreaming) return
    const message = lastFailedMessageRef.current
    // Quita el par (usuario, asistente vacio) del intento fallido antes de
    // volver a mandarlo -- sendMessage ya agrega su propio par nuevo.
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
