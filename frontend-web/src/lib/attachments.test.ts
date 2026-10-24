import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ENCRYPTED_PDF, GIF, HEIC, JPEG, PLAIN_PDF, PNG, WEBP, file } from '@/test/fixtures'
import {
  IMAGE_MAX_SIDE,
  MAX_PDF_BYTES,
  classifyFile,
  formatBytes,
  imageThumbnail,
  looksEncrypted,
  normalizeImage,
  pastedImageName,
  sniffKind,
} from './attachments'

describe('sniffKind', () => {
  it('knows each supported kind by its first bytes', () => {
    expect(sniffKind(PLAIN_PDF)).toBe('pdf')
    expect(sniffKind(PNG)).toBe('png')
    expect(sniffKind(JPEG)).toBe('jpeg')
    expect(sniffKind(WEBP)).toBe('webp')
  })

  it('recognises an iPhone HEIC photo, only to be able to say why it is refused', () => {
    expect(sniffKind(HEIC)).toBe('heic')
  })

  it('does not know anything else', () => {
    expect(sniffKind(GIF)).toBe('unknown')
    expect(sniffKind(new Uint8Array())).toBe('unknown')
    expect(sniffKind(new TextEncoder().encode('hola, esto es texto'))).toBe('unknown')
  })
})

describe('looksEncrypted', () => {
  const ends = (bytes: Uint8Array) => ({
    head: bytes.slice(0, 8192),
    tail: bytes.slice(Math.max(0, bytes.length - 8192)),
  })

  it('sees the /Encrypt entry of a real encrypted PDF', () => {
    const { head, tail } = ends(ENCRYPTED_PDF)
    expect(looksEncrypted(head, tail)).toBe(true)
  })

  it('does not flag a plain PDF', () => {
    const { head, tail } = ends(PLAIN_PDF)
    expect(looksEncrypted(head, tail)).toBe(false)
  })

  it('finds it at either end (linearized PDFs keep the trailer at the start)', () => {
    const marker = new TextEncoder().encode('trailer << /Encrypt 12 0 R >>')
    const filler = new Uint8Array(100)
    expect(looksEncrypted(marker, filler)).toBe(true)
    expect(looksEncrypted(filler, marker)).toBe(true)
    expect(looksEncrypted(filler, filler)).toBe(false)
  })

  it('does not take a longer word for the entry', () => {
    const text = new TextEncoder().encode('/EncryptedNote is not a trailer entry')
    expect(looksEncrypted(text, new Uint8Array())).toBe(false)
  })
})

describe('classifyFile', () => {
  it('a plain PDF needs no password', async () => {
    expect(await classifyFile(file(PLAIN_PDF, 'estado.pdf', 'application/pdf'))).toEqual({
      kind: 'pdf',
      encrypted: false,
    })
  })

  it('an encrypted PDF is flagged, so only it will ask for a password', async () => {
    expect(await classifyFile(file(ENCRYPTED_PDF, 'estado.pdf', 'application/pdf'))).toEqual({
      kind: 'pdf',
      encrypted: true,
    })
  })

  it('goes by the content, not by the name or the declared type', async () => {
    expect(await classifyFile(file(PNG, 'captura.pdf', 'application/pdf'))).toEqual({ kind: 'image' })
    expect(await classifyFile(file(PLAIN_PDF, 'estado', 'application/octet-stream'))).toEqual({
      kind: 'pdf',
      encrypted: false,
    })
  })

  it('accepts the three image formats', async () => {
    for (const bytes of [PNG, JPEG, WEBP]) {
      expect(await classifyFile(file(bytes, 'x'))).toEqual({ kind: 'image' })
    }
  })

  it('refuses what it cannot read, with the reason', async () => {
    expect(await classifyFile(file(GIF, 'a.gif', 'image/gif'))).toEqual({ kind: 'rejected', reason: 'unsupported' })
    expect(await classifyFile(file(HEIC, 'IMG_1.HEIC', 'image/heic'))).toEqual({ kind: 'rejected', reason: 'heic' })
    expect(await classifyFile(file(new Uint8Array(), 'vacio.png'))).toEqual({ kind: 'rejected', reason: 'unsupported' })
  })

  it('refuses a PDF over the limit', async () => {
    const big = new Uint8Array(MAX_PDF_BYTES + 1)
    big.set(PLAIN_PDF.slice(0, 8))
    expect(await classifyFile(file(big, 'enorme.pdf'))).toEqual({ kind: 'rejected', reason: 'tooLarge' })
  })
})

describe('pastedImageName', () => {
  it('gives a pasted screenshot a dated name instead of "image.png"', () => {
    const now = new Date(2026, 9, 15, 9, 5, 7)
    expect(pastedImageName('image/png', now)).toBe('captura-20261015-090507.png')
    expect(pastedImageName('image/jpeg', now)).toBe('captura-20261015-090507.jpg')
  })
})

describe('formatBytes', () => {
  it('reads well at each size', () => {
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})

describe('imageThumbnail', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('is a small data URL that does not depend on any object URL staying alive', async () => {
    let size = { width: 0, height: 0 }
    vi.stubGlobal('createImageBitmap', async () => ({ width: 600, height: 1200, close: vi.fn() }))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      size = { width: this.width, height: this.height }
      return { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,abc')
    expect(await imageThumbnail(file(PNG, 'ticket.png', 'image/png'))).toBe('data:image/jpeg;base64,abc')
    expect(size).toEqual({ width: 96, height: 192 })
  })

  it('is null when the browser cannot decode the image', async () => {
    vi.stubGlobal('createImageBitmap', async () => {
      throw new Error('decode')
    })
    expect(await imageThumbnail(file(PNG, 'rota.png', 'image/png'))).toBeNull()
  })
})

describe('normalizeImage', () => {
  let canvasSize: { width: number; height: number }
  let blobSizes: Record<string, number>
  const requested: string[] = []

  beforeEach(() => {
    requested.length = 0
    blobSizes = { 'image/png': 1000, 'image/jpeg': 800, 'image/webp': 900 }
    canvasSize = { width: 0, height: 0 }
    vi.stubGlobal('createImageBitmap', async () => ({ width: 3136, height: 1568, close: vi.fn() }))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      canvasSize = { width: this.width, height: this.height }
      return { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => {
      requested.push(type ?? '')
      callback(new Blob([new Uint8Array(blobSizes[type ?? 'image/png'] ?? 10)], { type }))
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shrinks a large screenshot so its long side is at most the limit, keeping the proportion', async () => {
    await normalizeImage(file(PNG, 'captura.png', 'image/png'))
    expect(canvasSize).toEqual({ width: IMAGE_MAX_SIDE, height: IMAGE_MAX_SIDE / 2 })
  })

  it('never enlarges a small one', async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 800, height: 600, close: vi.fn() }))
    await normalizeImage(file(PNG, 'chica.png', 'image/png'))
    expect(canvasSize).toEqual({ width: 800, height: 600 })
  })

  it('keeps a PNG a PNG so the text stays sharp, and a JPEG a JPEG', async () => {
    const png = await normalizeImage(file(PNG, 'a.png', 'image/png'))
    const jpeg = await normalizeImage(file(JPEG, 'b.jpg', 'image/jpeg'))
    expect([png.type, png.name]).toEqual(['image/png', 'a.png'])
    expect([jpeg.type, jpeg.name]).toEqual(['image/jpeg', 'b.jpg'])
  })

  it('falls back to JPEG when the PNG is still too heavy, and renames it', async () => {
    blobSizes['image/png'] = 5 * 1024 * 1024
    const out = await normalizeImage(file(PNG, 'pesada.png', 'image/png'))
    expect(requested).toEqual(['image/png', 'image/jpeg'])
    expect([out.type, out.name]).toEqual(['image/jpeg', 'pesada.jpg'])
  })

  it('re-encodes always (that is what drops the EXIF/GPS metadata of a phone photo)', async () => {
    await normalizeImage(file(JPEG, 'foto.jpg', 'image/jpeg'))
    expect(requested).toEqual(['image/jpeg'])
  })

  it('fails when the browser cannot decode the image', async () => {
    vi.stubGlobal('createImageBitmap', async () => {
      throw new Error('decode')
    })
    await expect(normalizeImage(file(PNG, 'rota.png', 'image/png'))).rejects.toThrow()
  })
})
