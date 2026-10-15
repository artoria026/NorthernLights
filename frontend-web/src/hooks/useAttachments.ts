import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  type RejectionReason,
  classifyFile,
  normalizeImage,
  pastedImageName,
} from '@/lib/attachments'

export interface PendingAttachment {
  id: string
  file: File
  kind: 'pdf' | 'image'
  /** An encrypted PDF needs its own password; nothing else ever does. */
  encrypted: boolean
  password: string
  /** The server said this file's password is wrong (or missing). */
  passwordError: boolean
  /** Object URL for the thumbnail of an image. */
  previewUrl: string | null
}

export interface RejectedFile {
  name: string
  reason: RejectionReason
}

let nextId = 0
const newId = () => `attachment-${++nextId}`

/** The files waiting to be sent with the next chat message.
 *
 * Adding classifies each file by its content: PDFs are checked for encryption (and
 * only those get a password field), screenshots are shrunk and re-encoded. A file
 * that can't go is reported back instead of added. */
export function useAttachments() {
  const [items, setItems] = useState<PendingAttachment[]>([])
  const [processing, setProcessing] = useState(false)
  const itemsRef = useRef(items)
  itemsRef.current = items

  const revoke = (item: PendingAttachment) => {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
  }

  useEffect(
    () => () => {
      for (const item of itemsRef.current) revoke(item)
    },
    [],
  )

  const addFiles = useCallback(async (incoming: File[]): Promise<RejectedFile[]> => {
    const rejected: RejectedFile[] = []
    const accepted: PendingAttachment[] = []
    setProcessing(true)
    try {
      for (const original of incoming) {
        if (itemsRef.current.length + accepted.length >= MAX_ATTACHMENTS) {
          rejected.push({ name: original.name, reason: 'tooMany' })
          continue
        }
        const classified = await classifyFile(original)
        if (classified.kind === 'rejected') {
          rejected.push({ name: original.name, reason: classified.reason })
          continue
        }
        if (classified.kind === 'pdf') {
          accepted.push({
            id: newId(),
            file: original,
            kind: 'pdf',
            encrypted: classified.encrypted,
            password: '',
            passwordError: false,
            previewUrl: null,
          })
          continue
        }
        try {
          // The browser calls every pasted screenshot "image.png": give it a real name.
          const named =
            original.name === 'image.png' || original.name === ''
              ? new File([original], pastedImageName(original.type), { type: original.type })
              : original
          const file = await normalizeImage(named)
          if (file.size > MAX_IMAGE_BYTES) {
            rejected.push({ name: original.name, reason: 'tooLarge' })
            continue
          }
          accepted.push({
            id: newId(),
            file,
            kind: 'image',
            encrypted: false,
            password: '',
            passwordError: false,
            previewUrl: URL.createObjectURL(file),
          })
        } catch {
          rejected.push({ name: original.name, reason: 'unreadable' })
        }
      }
    } finally {
      setProcessing(false)
    }
    if (accepted.length > 0) setItems((prev) => [...prev, ...accepted])
    return rejected
  }, [])

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const gone = prev.find((i) => i.id === id)
      if (gone) revoke(gone)
      return prev.filter((i) => i.id !== id)
    })
  }, [])

  const setPassword = useCallback((id: string, password: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, password, passwordError: false } : i)))
  }, [])

  /** The server refused this file's password (or found a PDF encrypted that the
   * quick check had missed): make sure its password field is there, and flag it. */
  const flagPasswordProblem = useCallback((index: number) => {
    setItems((prev) =>
      prev.map((i, position) => (position === index ? { ...i, encrypted: true, passwordError: true } : i)),
    )
  }, [])

  /** Empties the list. `keepPreviews` hands the thumbnails' object URLs over to the
   * chat bubble that now shows them instead of freeing them. */
  const clear = useCallback((options?: { keepPreviews?: boolean }) => {
    setItems((prev) => {
      if (!options?.keepPreviews) for (const item of prev) revoke(item)
      return []
    })
  }, [])

  /** What goes to the server: the files, and each one's password (null when it has none). */
  const payload = useCallback(
    () => ({
      files: itemsRef.current.map((i) => i.file),
      passwords: itemsRef.current.map((i) => (i.encrypted && i.password ? i.password : null)),
    }),
    [],
  )

  return {
    items,
    processing,
    addFiles,
    remove,
    setPassword,
    flagPasswordProblem,
    clear,
    payload,
    /** An encrypted PDF is waiting for its password: sending now would be refused. */
    missingPassword: items.some((i) => i.encrypted && !i.password),
  }
}
