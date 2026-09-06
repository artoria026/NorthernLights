import i18n from './i18n'

const IMAGE_MAX_SOURCE_BYTES = 8 * 1024 * 1024 // 8MB input, before normalizing

function readImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(i18n.t('image.couldNotReadImage', { ns: 'common' })))
    }
    img.src = url
  })
}

/** Any PNG/JPG/WebP the user uploads is normalized to a `size`x`size`
 * square (contain, transparent background) before saving -- this way it
 * looks consistent regardless of the original's size/aspect ratio (account
 * logo, profile photo), and the backend doesn't have to accept images of
 * any size. */
export async function fileToNormalizedDataUrl(file: File, size = 128): Promise<string> {
  const img = await readImage(file)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(i18n.t('image.couldNotProcessImage', { ns: 'common' }))
  const scale = Math.min(size / img.width, size / img.height)
  const w = img.width * scale
  const h = img.height * scale
  ctx.clearRect(0, 0, size, size)
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
  return canvas.toDataURL('image/png')
}

/** null if the file passes the basic validations, or the error message to
 * show if not. */
export function validateImageFile(file: File): string | null {
  if (!file.type.startsWith('image/')) {
    return i18n.t('image.selectValidImage', { ns: 'common' })
  }
  if (file.size > IMAGE_MAX_SOURCE_BYTES) {
    return i18n.t('image.imageTooLarge', { ns: 'common' })
  }
  return null
}
