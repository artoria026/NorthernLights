import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ENCRYPTED_PDF, GIF, HEIC, PLAIN_PDF, PNG, file } from '@/test/fixtures'
import { MAX_ATTACHMENTS } from '@/lib/attachments'
import { useAttachments } from './useAttachments'

vi.mock('@/lib/attachments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/attachments')>()),
  // jsdom can't decode images: the shrinking itself is covered in attachments.test.ts.
  normalizeImage: async (f: File) => f,
}))

const pdf = (name = 'estado.pdf') => file(PLAIN_PDF, name, 'application/pdf')
const lockedPdf = (name = 'cifrado.pdf') => file(ENCRYPTED_PDF, name, 'application/pdf')

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

describe('useAttachments', () => {
  it('adds a plain PDF without asking for any password', async () => {
    const { result } = renderHook(() => useAttachments())
    await act(() => result.current.addFiles([pdf()]))
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0]).toMatchObject({ kind: 'pdf', encrypted: false })
    expect(result.current.missingPassword).toBe(false)
  })

  it('an encrypted PDF blocks sending until its own password is typed', async () => {
    const { result } = renderHook(() => useAttachments())
    await act(() => result.current.addFiles([pdf(), lockedPdf()]))
    expect(result.current.missingPassword).toBe(true)
    act(() => result.current.setPassword(result.current.items[1].id, 'clave123'))
    expect(result.current.missingPassword).toBe(false)
  })

  it('sends one password slot per file, empty for the ones that need none', async () => {
    const { result } = renderHook(() => useAttachments())
    await act(() => result.current.addFiles([pdf(), file(PNG, 'a.png'), lockedPdf()]))
    act(() => result.current.setPassword(result.current.items[2].id, 'clave123'))
    const payload = result.current.payload()
    expect(payload.files.map((f) => f.name)).toEqual(['estado.pdf', 'a.png', 'cifrado.pdf'])
    expect(payload.passwords).toEqual([null, null, 'clave123'])
  })

  it('gives a screenshot a thumbnail and a pasted "image.png" a real name', async () => {
    const { result } = renderHook(() => useAttachments())
    await act(() => result.current.addFiles([file(PNG, 'image.png', 'image/png')]))
    expect(result.current.items[0].previewUrl).toBe('blob:preview')
    expect(result.current.items[0].file.name).toMatch(/^captura-\d{8}-\d{6}\.png$/)
  })

  it('reports what it cannot take instead of adding it', async () => {
    const { result } = renderHook(() => useAttachments())
    let rejected: Awaited<ReturnType<typeof result.current.addFiles>> = []
    await act(async () => {
      rejected = await result.current.addFiles([file(GIF, 'a.gif'), file(HEIC, 'b.heic'), pdf()])
    })
    expect(rejected).toEqual([
      { name: 'a.gif', reason: 'unsupported' },
      { name: 'b.heic', reason: 'heic' },
    ])
    expect(result.current.items).toHaveLength(1)
  })

  it('holds at most five files between images and PDFs together', async () => {
    const { result } = renderHook(() => useAttachments())
    const seven = [pdf('1.pdf'), file(PNG, '2.png'), pdf('3.pdf'), file(PNG, '4.png'), pdf('5.pdf'), pdf('6.pdf'), file(PNG, '7.png')]
    let rejected: Awaited<ReturnType<typeof result.current.addFiles>> = []
    await act(async () => {
      rejected = await result.current.addFiles(seven)
    })
    expect(result.current.items).toHaveLength(MAX_ATTACHMENTS)
    expect(rejected.map((r) => [r.name, r.reason])).toEqual([
      ['6.pdf', 'tooMany'],
      ['7.png', 'tooMany'],
    ])
  })

  it('flags the file whose password the server refused, even if it looked plain', async () => {
    const { result } = renderHook(() => useAttachments())
    await act(() => result.current.addFiles([pdf(), pdf('otro.pdf')]))
    act(() => result.current.flagPasswordProblem(1))
    expect(result.current.items[0]).toMatchObject({ encrypted: false, passwordError: false })
    expect(result.current.items[1]).toMatchObject({ encrypted: true, passwordError: true })
    act(() => result.current.setPassword(result.current.items[1].id, 'x'))
    expect(result.current.items[1].passwordError).toBe(false)
  })

  it('frees the thumbnail when a file is removed or the list cleared, unless the chat keeps it', async () => {
    const { result } = renderHook(() => useAttachments())
    await act(() => result.current.addFiles([file(PNG, 'a.png'), file(PNG, 'b.png')]))
    act(() => result.current.remove(result.current.items[0].id))
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    act(() => result.current.clear({ keepPreviews: true }))
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(result.current.items).toEqual([])
  })
})
