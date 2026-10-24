import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Debt } from '@/types'
import { DebtsList } from './Debts'

const mocks = vi.hoisted(() => ({ pause: vi.fn(), resume: vi.fn() }))

vi.mock('@/hooks/useAccounts', () => ({ useAccounts: () => ({ data: [] }) }))
vi.mock('@/hooks/useDebts', () => ({
  useDeleteDebt: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePauseDebt: () => ({ mutate: mocks.pause, isPending: false }),
  useResumeDebt: () => ({ mutate: mocks.resume, isPending: false }),
  useDebtMovements: () => ({ data: [], isLoading: false }),
  useIncreaseDebt: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRegisterDebtPayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateDebt: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const debt = (overrides: Partial<Debt>): Debt =>
  ({
    id: '1',
    name: 'Nu tarjeta',
    direction: 'owed_by_me',
    type: 'credit',
    status: 'active',
    total_amount: '1000.00',
    current_balance: '800.00',
    interest_rate: '0',
    payment_amount: null,
    ...overrides,
  }) as Debt

describe('paused debts', () => {
  it('an active debt can be paused', () => {
    render(<DebtsList debts={[debt({})]} />)
    fireEvent.click(screen.getByRole('button', { name: /Pausar|Pause/ }))
    expect(mocks.pause).toHaveBeenCalledWith('1')
    expect(screen.queryByText(/En pausa|Paused/)).toBeNull()
  })

  it('a paused debt says so, can be resumed, and can still be paid', () => {
    render(<DebtsList debts={[debt({ status: 'paused' })]} />)
    expect(screen.getByText(/En pausa|Paused/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Pagar|Pay/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Reanudar|Resume/ }))
    expect(mocks.resume).toHaveBeenCalledWith('1')
  })
})
