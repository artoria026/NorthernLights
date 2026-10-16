import { Pencil, Tags as TagsIcon, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ColorSwatchPicker } from '@/components/nl/ColorSwatchPicker'
import { TagSummaryPanel } from '@/components/nl/TagSummaryPanel'
import { EmptyState, HEADER_SECTIONS, ViewHeader } from '@/components/nl/primitives'
import { useCreateTag, useDeleteTag, useTags, useUpdateTag } from '@/hooks/useTags'
import { CATEGORY_COLOR_CHOICES } from '@/lib/categoryIcons'
import { formatMoney, selectClass } from '@/lib/utils'
import { apiErrorMessage } from '@/services/api'
import { useConfirmStore } from '@/stores/confirmStore'
import { useUiStore } from '@/stores/uiStore'
import type { TagWithStats } from '@/types'

function TagForm({
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial?: { name: string; color: string }
  submitLabel: string
  pending: boolean
  onSubmit: (value: { name: string; color: string }) => void
  onCancel?: () => void
}) {
  const { t } = useTranslation('pages')
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState(initial?.color ?? CATEGORY_COLOR_CHOICES[0])
  const valid = name.trim().length > 0

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onSubmit({ name: name.trim(), color })
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={80}
        placeholder={t('tags.form.namePlaceholder')}
        aria-label={t('tags.form.nameLabel')}
        className={`${selectClass} h-9 w-full`}
      />
      <ColorSwatchPicker value={color} onChange={setColor} />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!valid || pending}
          className="rounded-md px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-40"
          style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
        >
          {submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
          >
            {t('tags.form.cancel')}
          </button>
        )}
      </div>
    </form>
  )
}

export function Tags() {
  const { t } = useTranslation('pages')
  const { data: tags = [], isLoading } = useTags()
  const createTag = useCreateTag()
  const updateTag = useUpdateTag()
  const deleteTag = useDeleteTag()
  const pushToast = useUiStore((s) => s.pushToast)
  const confirm = useConfirmStore((s) => s.ask)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const selected: TagWithStats | undefined = tags.find((tag) => tag.id === selectedId) ?? tags[0]

  async function handleCreate(value: { name: string; color: string }) {
    try {
      const tag = await createTag.mutateAsync(value)
      setSelectedId(tag.id)
    } catch (error) {
      pushToast(apiErrorMessage(error), 'error')
    }
  }

  async function handleUpdate(value: { name: string; color: string }) {
    if (!selected) return
    try {
      await updateTag.mutateAsync({ id: selected.id, ...value })
      setEditing(false)
    } catch (error) {
      pushToast(apiErrorMessage(error), 'error')
    }
  }

  async function handleDelete() {
    if (!selected) return
    const ok = await confirm({
      title: t('tags.confirmDelete.title'),
      message: t('tags.confirmDelete.message', { name: selected.name, count: selected.transaction_count }),
      confirmLabel: t('tags.confirmDelete.confirm'),
      variant: 'danger',
    })
    if (!ok) return
    try {
      await deleteTag.mutateAsync(selected.id)
      setSelectedId(null)
      setEditing(false)
    } catch (error) {
      pushToast(apiErrorMessage(error), 'error')
    }
  }

  return (
    <div>
      <ViewHeader icon={<TagsIcon />} title={t('tags.title')} subtitle={t('tags.subtitle')} section={HEADER_SECTIONS.diario} />

      <div className="flex flex-col items-start gap-4 lg:flex-row">
        <div className="flex w-full flex-shrink-0 flex-col gap-4 lg:w-[320px]">
          <div className="rounded-md border border-border bg-card p-3.5">
            <h2 className="mb-3 text-[13px] font-semibold">{t('tags.new')}</h2>
            <TagForm submitLabel={t('tags.form.create')} pending={createTag.isPending} onSubmit={handleCreate} />
          </div>

          <div className="overflow-hidden rounded-md border border-border bg-card">
            {isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">{t('tags.states.loading')}</p>
            ) : tags.length === 0 ? (
              <EmptyState>{t('tags.empty')}</EmptyState>
            ) : (
              <ul>
                {tags.map((tag) => (
                  <li key={tag.id} className="border-t border-border first:border-t-0">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(tag.id)
                        setEditing(false)
                      }}
                      aria-current={tag.id === selected?.id}
                      className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-[var(--nl-bg-input)]"
                      style={tag.id === selected?.id ? { background: 'var(--nl-bg-input)' } : undefined}
                    >
                      <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ background: tag.color }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{tag.name}</span>
                        <span className="block text-[11.5px] text-muted-foreground">
                          {t('tags.listCount', { count: tag.transaction_count })}
                        </span>
                      </span>
                      <span className="flex-shrink-0 text-[13px]">{formatMoney(tag.total_spent)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="min-w-0 w-full flex-1 rounded-md border border-border bg-card p-4">
          {!selected ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t('tags.selectOne')}</p>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="h-3.5 w-3.5 flex-shrink-0 rounded-full" style={{ background: selected.color }} />
                  <h2 className="truncate text-base font-semibold">{selected.name}</h2>
                </div>
                <div className="flex flex-shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => setEditing((v) => !v)}
                    title={t('tags.actions.edit')}
                    aria-label={t('tags.actions.edit')}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-info/10 hover:text-info"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete()}
                    title={t('tags.actions.delete')}
                    aria-label={t('tags.actions.delete')}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              {editing && (
                <div className="rounded-md border border-border p-3.5">
                  <TagForm
                    key={selected.id}
                    initial={{ name: selected.name, color: selected.color }}
                    submitLabel={t('tags.form.save')}
                    pending={updateTag.isPending}
                    onSubmit={handleUpdate}
                    onCancel={() => setEditing(false)}
                  />
                </div>
              )}
              <TagSummaryPanel key={selected.id} tagId={selected.id} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
