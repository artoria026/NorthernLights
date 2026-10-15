import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PendingAttachment } from '@/hooks/useAttachments'
import { PLAIN_PDF, PNG, file } from '@/test/fixtures'
import { AttachmentTray } from './AttachmentTray'

const item = (over: Partial<PendingAttachment>): PendingAttachment => ({
  id: 'a1',
  file: file(PLAIN_PDF, 'estado.pdf'),
  kind: 'pdf',
  encrypted: false,
  password: '',
  passwordError: false,
  previewUrl: null,
  ...over,
})

describe('AttachmentTray', () => {
  it('shows nothing without files', () => {
    const { container } = render(<AttachmentTray items={[]} onRemove={vi.fn()} onPassword={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('asks for a password only on the encrypted PDF, one field per file', () => {
    render(
      <AttachmentTray
        items={[
          item({ id: 'a', file: file(PLAIN_PDF, 'abierto.pdf') }),
          item({ id: 'b', file: file(PLAIN_PDF, 'cifrado.pdf'), encrypted: true }),
          item({ id: 'c', file: file(PNG, 'captura.png'), kind: 'image', previewUrl: 'blob:x' }),
        ]}
        onRemove={vi.fn()}
        onPassword={vi.fn()}
      />,
    )
    expect(screen.getAllByPlaceholderText('Contraseña de este PDF')).toHaveLength(1)
    expect(screen.getByLabelText('Contraseña de cifrado.pdf')).toBeInTheDocument()
    expect(screen.queryByLabelText('Contraseña de abierto.pdf')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Contraseña de captura.png')).not.toBeInTheDocument()
  })

  it('reports typing and removal for the right file', () => {
    const onPassword = vi.fn()
    const onRemove = vi.fn()
    render(
      <AttachmentTray items={[item({ id: 'b', file: file(PLAIN_PDF, 'cifrado.pdf'), encrypted: true })]} onRemove={onRemove} onPassword={onPassword} />,
    )
    fireEvent.change(screen.getByLabelText('Contraseña de cifrado.pdf'), { target: { value: 'clave123' } })
    expect(onPassword).toHaveBeenCalledWith('b', 'clave123')
    fireEvent.click(screen.getByRole('button'))
    expect(onRemove).toHaveBeenCalledWith('b')
  })

  it('marks a refused password', () => {
    render(
      <AttachmentTray items={[item({ encrypted: true, passwordError: true })]} onRemove={vi.fn()} onPassword={vi.fn()} />,
    )
    expect(screen.getByText('Contraseña incorrecta')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Contraseña de este PDF')).toHaveAttribute('aria-invalid', 'true')
  })
})
