import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Transaction } from '@/types'
import { useAuthStore } from '@/stores/authStore'
import { InstallmentsCard } from './Accounts'

const mocks = vi.hoisted(() => ({ saved: [] as unknown[] }))
vi.mock('@/hooks/useAuth', () => ({
  useUpdateSettings: () => ({ mutate: (input: unknown) => mocks.saved.push(input) }),
}))

const plan = (id: string, name: string, date: string, paid: number, total: number, monthly: string) =>
  ({
    id,
    date,
    description: name,
    amount: String(Number(monthly) * total),
    installment: { total_installments: total, paid_installments: paid, monthly_amount: monthly },
  }) as unknown as Transaction

const installments = [
  plan('a', 'Tarjeta microSD SanDisk Extreme 128 GB', '2026-08-29', 1, 3, '191.00'),
  plan('b', 'Horno de microondas Midea 30 L', '2026-08-15', 2, 6, '333.17'),
  plan('c', 'Teclado mecánico EPOMAKER TH108 Pro', '2026-07-10', 3, 12, '170.47'),
]

beforeEach(() => useAuthStore.setState({ user: { installments_collapsed: false } as never }))
afterEach(() => {
  mocks.saved.length = 0
})

describe('InstallmentsCard (Cuentas)', () => {
  it('shows each plan with its progress, purchase date and what is left, and the monthly total', () => {
    render(<InstallmentsCard installments={installments} />)
    const detail = screen.getByTestId('installments-detail')
    expect(detail).toHaveTextContent('Teclado mecánico EPOMAKER TH108 Pro')
    expect(detail).toHaveTextContent('3/12')
    expect(detail).toHaveTextContent('2/6')
    expect(detail).toHaveTextContent('1/3')
    expect(detail).toHaveTextContent('faltan $1,534.23') // 9 x 170.47
    expect(detail).toHaveTextContent('faltan $1,332.68') // 4 x 333.17
    expect(detail).toHaveTextContent('faltan $382.00') // 2 x 191
    expect(screen.getByTestId('installments-panel')).toHaveTextContent('$694.64')
    expect(screen.getByText('3 compras a meses activas')).toBeInTheDocument()
  })

  it('collapses and expands from the header, and saves the choice on the account', () => {
    render(<InstallmentsCard installments={installments} />)
    const header = screen.getByRole('button', { name: /compras a meses activas/ })
    fireEvent.click(header)
    expect(screen.queryByTestId('installments-detail')).not.toBeInTheDocument()
    expect(header).toHaveAttribute('aria-expanded', 'false')
    // collapsed it still tells what matters: the monthly total and what is left in all
    expect(screen.getByTestId('installments-panel')).toHaveTextContent('$694.64')
    expect(screen.getByTestId('installments-panel')).toHaveTextContent('faltan $3,248.91')
    expect(mocks.saved).toContainEqual({ installments_collapsed: true })

    fireEvent.click(header)
    expect(screen.getByTestId('installments-detail')).toBeInTheDocument()
    expect(mocks.saved).toContainEqual({ installments_collapsed: false })
  })

  it('opens collapsed when the account says the user left it that way', () => {
    useAuthStore.setState({ user: { installments_collapsed: true } as never })
    render(<InstallmentsCard installments={installments} />)
    expect(screen.queryByTestId('installments-detail')).not.toBeInTheDocument()
  })
})
