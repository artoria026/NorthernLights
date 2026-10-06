/** Saves `blob` through a temporary link. The name comes from the response's
 * Content-Disposition when it has one, otherwise `fallbackName`. */
export function downloadBlob(blob: Blob, fallbackName: string, disposition?: string) {
  const filename = /filename="?([^";]+)"?/.exec(disposition ?? '')?.[1] ?? fallbackName
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
