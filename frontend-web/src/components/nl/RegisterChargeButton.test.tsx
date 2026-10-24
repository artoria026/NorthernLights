import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RegisterChargeButton } from './RegisterChargeButton'

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn() }))

vi.mock('@/hooks/useRecurring', () => ({
  useRegisterRecurringCharge: () => ({ mutateAsync: mocks.mutateAsync, isPending: false, isError: false }),
}))

const item = { id: 'item-1', name: 'Hetzner', amount: '209.08' }

beforeEach(() => {
  mocks.mutateAsync.mockReset().mockResolvedValue({})
})

describe('RegisterChargeButton', () => {
  it('registers the charge with the chosen date and closes', async () => {
    render(<RegisterChargeButton item={item} />)
    fireEvent.click(screen.getByRole('button', { name: /Registrar cargo|Register charge/ }))
    const date = await screen.findByDisplayValue(/^\d{4}-\d{2}-\d{2}$/)
    fireEvent.change(date, { target: { value: '2026-10-14' } })
    fireEvent.click(screen.getAllByRole('button', { name: /Registrar cargo|Register charge/ }).at(-1)!)
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith({ id: 'item-1', date: '2026-10-14' }))
    await waitFor(() => expect(screen.queryByDisplayValue('2026-10-14')).toBeNull())
  })

  it('says what will happen before anything is registered', async () => {
    render(<RegisterChargeButton item={item} highlight />)
    fireEvent.click(screen.getByRole('button', { name: /Registrar cargo|Register charge/ }))
    await screen.findByText(/209|\$209/)
    expect(mocks.mutateAsync).not.toHaveBeenCalled()
  })
})
