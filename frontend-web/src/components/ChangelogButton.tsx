import { Bug, Check, Lightbulb, Megaphone, Send } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useUpdateSettings } from '@/hooks/useAuth'
import { type FeedbackType, useCreateFeedback } from '@/hooks/useFeedback'
import { getRecentChangelog, LATEST_CHANGELOG_VERSION } from '@/lib/changelog'
import { apiErrorMessage } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import { useUiStore } from '@/stores/uiStore'

function FeedbackForm() {
  const [type, setType] = useState<FeedbackType>('bug')
  const [message, setMessage] = useState('')
  const createFeedback = useCreateFeedback()
  const pushToast = useUiStore((s) => s.pushToast)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (message.trim().length < 3) return
    try {
      await createFeedback.mutateAsync({ type, message: message.trim() })
      setMessage('')
      pushToast(
        type === 'bug' ? 'Gracias, ya lo reportamos.' : 'Gracias por la idea, la vamos a revisar.',
        'success',
      )
    } catch (error) {
      pushToast(apiErrorMessage(error), 'error')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <p className="text-[12px] font-medium text-muted-foreground">
        ¿Encontraste un bug o tenés una idea para mejorar la app?
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setType('bug')}
          className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg border text-[12.5px] transition-colors"
          style={{
            borderColor: type === 'bug' ? 'var(--nl-danger)' : 'var(--nl-border)',
            background: type === 'bug' ? 'var(--nl-danger-soft-bg)' : 'transparent',
            color: type === 'bug' ? 'var(--nl-danger-ink)' : 'var(--nl-text-secondary)',
          }}
        >
          <Bug size={13} />
          Reportar un bug
        </button>
        <button
          type="button"
          onClick={() => setType('feature')}
          className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg border text-[12.5px] transition-colors"
          style={{
            borderColor: type === 'feature' ? 'var(--nl-accent)' : 'var(--nl-border)',
            background: type === 'feature' ? 'var(--nl-accent-soft-bg)' : 'transparent',
            color: type === 'feature' ? 'var(--nl-accent-ink)' : 'var(--nl-text-secondary)',
          }}
        >
          <Lightbulb size={13} />
          Sugerir una función
        </button>
      </div>
      <textarea
        required
        minLength={3}
        maxLength={2000}
        rows={3}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={
          type === 'bug' ? 'Contanos qué pasó y en qué pantalla...' : 'Contanos tu idea...'
        }
        className="w-full rounded-lg border border-border px-3 py-2 text-[13px] outline-none transition-colors resize-none focus:border-[var(--nl-accent)]"
        style={{ background: 'var(--nl-bg-input)' }}
      />
      <button
        type="submit"
        disabled={createFeedback.isPending || message.trim().length < 3}
        className="self-end flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[12.5px] font-medium disabled:opacity-50"
        style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
      >
        <Send size={13} />
        {createFeedback.isPending ? 'Enviando...' : 'Enviar'}
      </button>
    </form>
  )
}

/** Icono de novedades -- SOLO el trigger (boton + punto rojo). AppSidebar lo
 * dibuja dos veces (barra movil y sidebar de escritorio, ambas montadas
 * siempre a la vez, una nomas queda oculta por CSS segun el ancho de
 * pantalla). El modal en si vive en ChangelogDialog, una sola instancia
 * compartida (useUiStore) -- si el modal tambien viviera aqui, cada icono
 * tendria su propio auto-open y el changelog "salia dos veces" (cerrabas
 * uno y aparecia el otro detras). */
export function ChangelogButton({ iconSize = 16 }: { iconSize?: number }) {
  const user = useAuthStore((s) => s.user)
  const setChangelogOpen = useUiStore((s) => s.setChangelogOpen)
  const hasUnseen = !!user && user.last_seen_changelog_version !== LATEST_CHANGELOG_VERSION

  return (
    <button
      type="button"
      title="Novedades"
      onClick={() => setChangelogOpen(true)}
      className="group relative p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
    >
      <Megaphone
        size={iconSize}
        strokeWidth={1.8}
        className="origin-bottom-left group-hover:[animation:nlIconRing_0.5s_ease]"
      />
      {hasUnseen && (
        <span
          className="absolute top-1 right-1 w-[7px] h-[7px] rounded-full"
          style={{ background: 'var(--nl-danger)' }}
        />
      )}
    </button>
  )
}

/** El modal con el detalle de cada release y el formulario de feedback --
 * renderizado UNA sola vez (ver AppSidebar.tsx), aunque ChangelogButton
 * aparezca en mas de un lugar. Si el usuario todavia no vio la version mas
 * reciente (`user.last_seen_changelog_version` desactualizado o null), se
 * auto-abre una vez al cargar -- al cerrarlo (X, click afuera, o el boton
 * "Entendido") se marca como visto via useUpdateSettings, mismo patron que
 * el tema: viaja con la cuenta, no queda solo en este navegador. */
export function ChangelogDialog() {
  const user = useAuthStore((s) => s.user)
  const updateSettings = useUpdateSettings()
  const hasUnseen = !!user && user.last_seen_changelog_version !== LATEST_CHANGELOG_VERSION
  const open = useUiStore((s) => s.changelogOpen)
  const setOpen = useUiStore((s) => s.setChangelogOpen)
  const autoShownRef = useRef(false)

  useEffect(() => {
    if (hasUnseen && !autoShownRef.current) {
      autoShownRef.current = true
      setOpen(true)
    }
  }, [hasUnseen, setOpen])

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next && hasUnseen) {
      updateSettings.mutate({ last_seen_changelog_version: LATEST_CHANGELOG_VERSION })
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[95vw] max-w-[95vw] sm:max-w-[95vw] xl:max-w-[1400px] h-[88vh] max-h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Novedades</DialogTitle>
        </DialogHeader>
        <div className="grid md:grid-cols-[1.3fr_1fr] gap-6 overflow-y-auto pr-1 flex-1 min-h-0">
          <div className="flex flex-col gap-5">
            {getRecentChangelog().map((entry) => (
              <div key={entry.version} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-mono font-semibold flex-shrink-0"
                      style={{ background: 'var(--nl-accent-soft-bg)', color: 'var(--nl-accent-ink)' }}
                    >
                      v{entry.version}
                    </span>
                    <span className="text-[15px] font-medium">{entry.title}</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground flex-shrink-0">
                    {new Date(entry.date).toLocaleDateString('es-MX', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                      timeZone: 'UTC',
                    })}
                  </span>
                </div>
                <ul className="flex flex-col gap-2 list-disc pl-4">
                  {entry.items.map((item) => (
                    <li key={item} className="text-[13.5px] text-muted-foreground leading-relaxed">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="border-t md:border-t-0 md:border-l border-border pt-4 md:pt-0 md:pl-6">
            <FeedbackForm />
          </div>
        </div>

        <button
          type="button"
          onClick={() => handleOpenChange(false)}
          className="flex items-center gap-1.5 rounded px-4 py-2 text-[13px] font-medium mt-1 self-start"
          style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
        >
          <Check size={14} />
          Entendido
        </button>
      </DialogContent>
    </Dialog>
  )
}
