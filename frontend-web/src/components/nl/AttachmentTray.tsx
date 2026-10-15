import { FileText, Lock, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PendingAttachment } from '@/hooks/useAttachments'
import { formatBytes } from '@/lib/attachments'

/** The files waiting to go with the next message: a thumbnail for each screenshot,
 * an icon for each PDF. Only a PDF that is actually encrypted shows a password field
 * (its own: every statement can have a different one). */
export function AttachmentTray({
  items,
  disabled,
  onRemove,
  onPassword,
}: {
  items: PendingAttachment[]
  disabled?: boolean
  onRemove: (id: string) => void
  onPassword: (id: string, password: string) => void
}) {
  const { t } = useTranslation('pages')
  if (items.length === 0) return null

  return (
    <ul className="flex flex-wrap gap-2 mb-2" aria-label={t('advisor.attachments.listLabel')}>
      {items.map((item) => (
        <li
          key={item.id}
          className="flex items-center gap-2 rounded-lg border border-border p-1.5 pr-2 text-xs max-w-full"
          style={{ background: 'var(--nl-bg-input)' }}
        >
          {item.kind === 'image' && item.previewUrl ? (
            <img
              src={item.previewUrl}
              alt=""
              className="h-10 w-10 flex-shrink-0 rounded-md object-cover border border-border"
            />
          ) : (
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground">
              <FileText size={16} />
            </span>
          )}
          <span className="flex min-w-0 flex-col gap-1">
            <span className="truncate max-w-[180px]" title={item.file.name}>
              {item.file.name}
            </span>
            {item.encrypted ? (
              <span className="flex items-center gap-1">
                <Lock
                  size={11}
                  className="flex-shrink-0"
                  style={{ color: item.passwordError ? 'var(--nl-danger-ink)' : undefined }}
                />
                <input
                  type="password"
                  value={item.password}
                  onChange={(e) => onPassword(item.id, e.target.value)}
                  disabled={disabled}
                  placeholder={t('advisor.attachments.passwordPlaceholder')}
                  aria-label={t('advisor.attachments.passwordLabel', { name: item.file.name })}
                  aria-invalid={item.passwordError}
                  autoComplete="off"
                  className="w-40 rounded border bg-transparent px-1.5 py-0.5 text-[11px] outline-none focus:border-ring"
                  style={{ borderColor: item.passwordError ? 'var(--nl-danger-ink)' : 'var(--border)' }}
                />
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">{formatBytes(item.file.size)}</span>
            )}
            {item.passwordError && (
              <span className="text-[11px]" style={{ color: 'var(--nl-danger-ink)' }}>
                {t('advisor.attachments.passwordWrong')}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            disabled={disabled}
            className="flex-shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-40"
            aria-label={t('advisor.removeAttachment', { name: item.file.name })}
          >
            <X size={13} />
          </button>
        </li>
      ))}
    </ul>
  )
}
