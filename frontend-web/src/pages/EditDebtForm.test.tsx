import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Debt } from '@/types'
import { EditDebtForm } from './Debts'

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn() }))

vi.mock('@/hooks/useAccounts', () => ({
  useAccounts: () => ({ data: [{ id: 'a1', name: 'Santander', type: 'asset' }] }),
}))
vi.mock('@/hooks/useDebts', () => ({
  useUpdateDebt: () => ({ mutateAsync: mocks.mutateAsync, isPending: false, isError: false }),
}))

const debt = {
  id: 'd1',
  name: 'Pavimento calle Educación Física',
  type: 'informal',
  creditor: null,
  notes: null,
  direction: 'owed_by_me',
  current_balance: '49218.75',
  payment_amount: null,
  payment_frequency: null,
  payment_day: null,
  next_payment_date: null,
  payment_source_account_id: null,
} as Debt

beforeEach(() => {
  mocks.mutateAsync.mockReset()
  mocks.mutateAsync.mockResolvedValue(debt)
})

describe('EditDebtForm terms', () => {
  it('sends what was lent, the total to pay and the rate as a fraction', async () => {
    render(<EditDebtForm debt={{ ...debt, original_amount: '50000.00', total_amount: '98700.00', interest_rate: '0.4750' }} onDone={vi.fn()} />)
    // numeric inputs in order: lent, total to pay, rate, payment amount, day
    const numbers = screen.getAllByRole('spinbutton')
    expect(numbers[0]).toHaveValue(50000)
    expect(numbers[1]).toHaveValue(98700)
    expect(numbers[2]).toHaveValue(47.5)
    fireEvent.change(numbers[1], { target: { value: '100000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalled())
    const input = mocks.mutateAsync.mock.calls[0][0].input
    expect(input.original_amount).toBe('50000.00')
    expect(input.total_amount).toBe('100000')
    expect(input.interest_rate).toBe('0.475')
  })
})

describe('EditDebtForm', () => {
  it('starts from what the debt already has', () => {
    render(<EditDebtForm debt={debt} onDone={vi.fn()} />)
    expect(screen.getByDisplayValue('Pavimento calle Educación Física')).toBeInTheDocument()
    expect(screen.getByText('Préstamo informal')).toBeInTheDocument()
  })

  it('sends the edits and leaves out the plan fields that are still empty', async () => {
    const onDone = vi.fn()
    render(<EditDebtForm debt={debt} onDone={onDone} />)

    fireEvent.change(screen.getByDisplayValue('Pavimento calle Educación Física'), {
      target: { value: 'Pavimento Educación Física' },
    })
    // text inputs in order: name, creditor, notes
    fireEvent.change(screen.getAllByRole('textbox')[1], {
      target: { value: 'Consejo de Urbanización' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalled())
    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      id: 'd1',
      input: {
        name: 'Pavimento Educación Física',
        type: 'informal',
        creditor: 'Consejo de Urbanización',
        notes: '',
        payment_amount: undefined,
        payment_frequency: undefined,
        payment_day: undefined,
        next_payment_date: undefined,
        payment_source_account_id: undefined,
      },
    })
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })
})
