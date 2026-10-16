import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TagWithStats } from '@/types'
import { TagPicker } from './TagPicker'

const tag = (id: string, name: string): TagWithStats => ({
  id,
  name,
  color: '#4e8ef0',
  transaction_count: 0,
  total_spent: '0',
  first_date: null,
  last_date: null,
})

const mocks = vi.hoisted(() => ({
  tags: [] as TagWithStats[],
  mutateAsync: vi.fn(),
}))

vi.mock('@/hooks/useTags', () => ({
  useTags: () => ({ data: mocks.tags }),
  useCreateTag: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}))

beforeEach(() => {
  mocks.tags = [tag('a', 'Viaje Mty'), tag('b', 'Negocios')]
  mocks.mutateAsync.mockReset()
})

describe('TagPicker', () => {
  it('toggles a tag on and off', () => {
    const onChange = vi.fn()
    const { rerender } = render(<TagPicker value={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Viaje Mty' }))
    expect(onChange).toHaveBeenLastCalledWith(['a'])

    rerender(<TagPicker value={['a']} onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Viaje Mty' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Viaje Mty' }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('creates a new tag on Enter and selects it', async () => {
    mocks.mutateAsync.mockResolvedValue(tag('c', 'Concierto'))
    const onChange = vi.fn()
    render(<TagPicker value={['a']} onChange={onChange} />)
    const input = screen.getByPlaceholderText('Nueva etiqueta (Enter para crearla)')
    fireEvent.change(input, { target: { value: '  Concierto ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(['a', 'c']))
    expect(mocks.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ name: 'Concierto' }))
    expect(input).toHaveValue('')
  })

  it('typing the name of an existing tag selects it instead of creating a duplicate', () => {
    const onChange = vi.fn()
    render(<TagPicker value={[]} onChange={onChange} />)
    const input = screen.getByPlaceholderText('Nueva etiqueta (Enter para crearla)')
    fireEvent.change(input, { target: { value: 'negocios' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(['b'])
    expect(mocks.mutateAsync).not.toHaveBeenCalled()
  })
})
