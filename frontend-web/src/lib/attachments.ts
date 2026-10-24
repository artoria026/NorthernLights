/** Files attached to the AI chat: PDFs (bank statements) and images (screenshots).
 *
 * What a file is comes from its CONTENT (its first bytes), never from its name or
 * the type the browser reports. A password is only ever asked for a PDF that is
 * actually encrypted. Screenshots are shrunk and re-encoded here before they leave
 * the browser (smaller upload, and the re-encode drops the EXIF metadata a phone
 * photo carries). Nothing here is stored anywhere. */

export const MAX_ATTACHMENTS = 5
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_PDF_BYTES = 15 * 1024 * 1024
/** Longest side a screenshot keeps: past this the model gets no more detail out of it. */
export const IMAGE_MAX_SIDE = 1568
export const ACCEPT_ATTACHMENTS = 'image/png,image/jpeg,image/webp,application/pdf'

export type FileKind = 'pdf' | 'png' | 'jpeg' | 'webp' | 'heic' | 'unknown'

export type RejectionReason = 'unsupported' | 'heic' | 'tooLarge' | 'tooMany' | 'unreadable'

export type Classified =
  | { kind: 'pdf'; encrypted: boolean }
  | { kind: 'image' }
  | { kind: 'rejected'; reason: RejectionReason }

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((byte, i) => bytes[offset + i] === byte)

/** PDF / PNG / JPEG / WebP (and HEIC, to say why it can't be read) by their first bytes. */
export function sniffKind(head: Uint8Array): FileKind {
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf' // %PDF-
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp'
  if (startsWith(head, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...head.slice(8, 12))
    if (['heic', 'heix', 'hevc', 'mif1', 'msf1'].includes(brand)) return 'heic'
  }
  return 'unknown'
}

const TRAILER_SCAN_BYTES = 8 * 1024

/** Does this PDF look encrypted? The encryption dictionary is referenced from the
 * trailer (`/Encrypt`), which sits at the end of a PDF -- or at the start of a
 * "linearized" one -- so looking at both ends is enough and avoids reading a
 * 15MB statement. A cheap heuristic for showing the password field early: the
 * server is the authority, and tells the app (PDF_PASSWORD_REQUIRED) if this missed. */
export function looksEncrypted(head: Uint8Array, tail: Uint8Array): boolean {
  const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes)
  return /\/Encrypt\b/.test(text(head)) || /\/Encrypt\b/.test(text(tail))
}

async function readBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

export async function classifyFile(file: File): Promise<Classified> {
  const kind = sniffKind(await readBytes(file.slice(0, 16)))
  if (kind === 'heic') return { kind: 'rejected', reason: 'heic' }
  if (kind === 'unknown') return { kind: 'rejected', reason: 'unsupported' }
  if (kind === 'pdf') {
    if (file.size > MAX_PDF_BYTES) return { kind: 'rejected', reason: 'tooLarge' }
    const head = await readBytes(file.slice(0, TRAILER_SCAN_BYTES))
    const tail = await readBytes(file.slice(Math.max(0, file.size - TRAILER_SCAN_BYTES)))
    return { kind: 'pdf', encrypted: looksEncrypted(head, tail) }
  }
  return { kind: 'image' }
}

const EXTENSION: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

function withExtension(name: string, type: string): string {
  const base = name.replace(/\.[^.]+$/, '')
  return `${base || 'captura'}.${EXTENSION[type] ?? 'png'}`
}

/** What a pasted screenshot is called (the browser says "image.png" for all of them). */
export function pastedImageName(type: string, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `captura-${stamp}.${EXTENSION[type] ?? 'png'}`
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob'))), type, quality)
  })
}

/** Shrinks a screenshot to at most IMAGE_MAX_SIDE on its long side and re-encodes it
 * (which also drops EXIF/GPS metadata). Keeps PNG for PNG, so text stays sharp; a
 * result that is still too heavy falls back to JPEG. Throws if the browser can't
 * decode the image. */
export async function normalizeImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas')
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()

  const keepType = file.type === 'image/jpeg' || file.type === 'image/webp' ? file.type : 'image/png'
  let blob = await toBlob(canvas, keepType, 0.9)
  if (blob.size > MAX_IMAGE_BYTES * 0.9 && keepType === 'image/png') {
    blob = await toBlob(canvas, 'image/jpeg', 0.85)
  }
  return new File([blob], withExtension(file.name, blob.type), { type: blob.type, lastModified: Date.now() })
}

/** A small, self-contained thumbnail (data URL) of an image, for the tray and the chat bubble.
 * Not an object URL on purpose: those die when anyone revokes them (a re-render, a hot reload,
 * leaving the screen) while the bubble is still showing it, and the picture breaks. A data URL
 * has no lifetime to manage. Null if the browser can't draw it: the UI falls back to the name. */
export async function imageThumbnail(file: File, side = 192): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    return canvas.toDataURL('image/jpeg', 0.8)
  } catch {
    return null
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
