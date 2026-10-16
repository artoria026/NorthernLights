import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCreateTag, useTags } from '@/hooks/useTags'
import { CATEGORY_COLOR_CHOICES } from '@/lib/categoryIcons'
import { apiErrorMessage } from '@/services/api'
import { useUiStore } from '@/stores/uiStore'

/** Choose which tags an expense carries: every tag is a toggle pill, and a new
 * one can be created on the spot (Enter or the + button) and is selected right
 * away. Inline on purpose -- it also has to work inside a modal. */
export function TagPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { t } = useTranslation('common')
  const { data: tags = [] } = useTags()
  const createTag = useCreateTag()
  const pushToast = useUiStore((s) => s.pushToast)
  const [draft, setDraft] = useState('')

  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])

  async function create() {
    const name = draft.trim()
    if (!name || createTag.isPending) return
    const existing = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      if (!value.includes(existing.id)) onChange([...value, existing.id])
      setDraft('')
      return
    }
    try {
      const color = CATEGORY_COLOR_CHOICES[tags.length % CATEGORY_COLOR_CHOICES.length]
      const tag = await createTag.mutateAsync({ name, color })
      onChange([...value, tag.id])
      setDraft('')
    } catch (error) {
      pushToast(apiErrorMessage(error), 'error')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('tags.pickerLabel')}>
          {tags.map((tag) => {
            const selected = value.includes(tag.id)
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggle(tag.id)}
                aria-pressed={selected}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors"
                style={{
                  borderColor: selected ? tag.color : 'var(--border)',
                  background: selected ? 'var(--nl-bg-input)' : 'transparent',
                  opacity: selected ? 1 : 0.7,
                }}
              >
                <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: tag.color }} />
                <span className="truncate">{tag.name}</span>
              </button>
            )
          })}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.stopPropagation()
              void create()
            }
          }}
          maxLength={80}
          placeholder={t('tags.newPlaceholder')}
          aria-label={t('tags.newPlaceholder')}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2.5 text-[12px] outline-none focus:border-ring"
        />
        <button
          type="button"
          onClick={() => void create()}
          disabled={!draft.trim() || createTag.isPending}
          aria-label={t('tags.create')}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  )
}
