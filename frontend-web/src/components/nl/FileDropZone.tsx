import { Upload } from 'lucide-react'
import { type DragEvent, type KeyboardEvent, useRef, useState } from 'react'

/** A box to drop a file on (or click / press Enter to pick one). Only reports the
 * file: what to do with it is up to the caller. */
export function FileDropZone({
  accept,
  acceptedExtensions,
  disabled,
  title,
  hint,
  rejectedMessage,
  onFile,
}: {
  /** The `accept` of the hidden <input type="file">. */
  accept: string
  /** Lowercase extensions that may be dropped, e.g. ['.xlsx']. */
  acceptedExtensions: string[]
  disabled?: boolean
  title: string
  hint?: string
  rejectedMessage: string
  onFile: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [rejected, setRejected] = useState(false)

  function take(file: File | undefined) {
    if (!file || disabled) return
    const ok = acceptedExtensions.some((ext) => file.name.toLowerCase().endsWith(ext))
    setRejected(!ok)
    if (ok) onFile(file)
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    take(event.dataTransfer.files?.[0])
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      inputRef.current?.click()
    }
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label={title}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={onKeyDown}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className="group flex min-h-[clamp(180px,28vh,320px)] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-6 py-10 text-center transition-all duration-300 ease-out hover:scale-[1.01] hover:border-[var(--nl-accent)] hover:bg-[var(--nl-accent-soft-bg)] hover:shadow-[0_0_0_4px_var(--nl-accent-soft-bg)] focus-visible:border-[var(--nl-accent)] focus-visible:outline-none focus-visible:shadow-[0_0_0_4px_var(--nl-accent-soft-bg)] aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:scale-100 aria-disabled:hover:shadow-none"
        style={
          dragging
            ? {
                borderColor: 'var(--nl-accent)',
                background: 'var(--nl-accent-soft-bg)',
                transform: 'scale(1.02)',
                boxShadow: '0 0 0 6px var(--nl-accent-soft-bg)',
              }
            : undefined
        }
      >
        <Upload
          size={30}
          className={`text-muted-foreground transition-all duration-300 group-hover:-translate-y-1.5 group-hover:text-[var(--nl-accent-ink)] group-focus-visible:-translate-y-1.5 ${
            dragging ? 'animate-bounce text-[var(--nl-accent-ink)]' : ''
          }`}
        />
        <p className="text-sm font-medium">{title}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          data-testid="file-input"
          onChange={(e) => {
            take(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
      {rejected && (
        <p className="mt-2 text-xs" style={{ color: 'var(--nl-danger-ink)' }}>
          {rejectedMessage}
        </p>
      )}
    </div>
  )
}
