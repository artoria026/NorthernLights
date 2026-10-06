import { Upload } from 'lucide-react'
import { useRef } from 'react'

/** File picker for a JSON export. Only picks the file -- what to do with it (and
 * the toasts) is up to the caller; `className` lets each screen match its buttons. */
export function ImportJsonButton({
  className,
  label,
  pendingLabel,
  pending,
  onFile,
}: {
  className: string
  label: string
  pendingLabel: string
  pending: boolean
  onFile: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.target.value = ''
        }}
      />
      <button type="button" disabled={pending} onClick={() => inputRef.current?.click()} className={className}>
        <Upload size={13} />
        {pending ? pendingLabel : label}
      </button>
    </>
  )
}
