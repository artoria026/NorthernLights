import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Debt, DebtMovement } from '@/types'
import { DebtHistory } from './Debts'

const mocks = vi.hoisted(() => ({ movements: { data: undefined as unknown, isLoading: false, isError: false } }))

vi.mock('@/hooks/useAccounts', () => ({ useAccounts: () => ({ data: [] }) }))
vi.mock('@/hooks/useDebts', () => ({
  useDebtMovements: () => mocks.movements,
  useIncreaseDebt: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
}))

const emanuel = { id: 'd1', name: 'Emanuel', direction: 'owed_to_me', current_balance: '1200.00' } as Debt

function movement(partial: Partial<DebtMovement> & { id: string }): DebtMovement {
  return {
    debt_id: 'd1',
    kind: 'loan',
    delta: '0',
    date: '2026-10-01',
    concept: null,
    account_id: null,
    account_name: null,
    journal_entry_id: null,
    created_at: '2026-10-01T15:30:00Z',
    balance_after: '0',
    ...partial,
  }
}

beforeEach(() => {
  mocks.movements = { data: undefined, isLoading: false, isError: false }
})

describe('DebtHistory', () => {
  it('lists why the debt grew and shrank, newest first, with the balance after each step', () => {
    mocks.movements = {
      isLoading: false,
      isError: false,
      data: [
        movement({ id: 'a', delta: '500.00', concept: 'Cena de cumpleaños', account_name: 'Santander', balance_after: '500.00' }),
        movement({ id: 'b', delta: '1000.00', concept: 'Reparación del coche', account_name: 'Santander', balance_after: '1500.00', date: '2026-10-05' }),
        movement({ id: 'c', kind: 'payment', delta: '-300.00', concept: 'Abono en efectivo', account_name: 'Efectivo', balance_after: '1200.00', date: '2026-10-10' }),
      ],
    }
    render(<DebtHistory debt={emanuel} />)

    const rows = within(screen.getByTestId('debt-history')).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    // newest first: the repayment, then the second loan, then the first
    expect(rows[0]).toHaveTextContent('Abono recibido')
    expect(rows[0]).toHaveTextContent('−$300.00')
    expect(rows[0]).toHaveTextContent('Abono en efectivo')
    expect(rows[0]).toHaveTextContent('Efectivo')
    expect(rows[0]).toHaveTextContent('saldo $1,200.00')
    expect(rows[1]).toHaveTextContent('Préstamo')
    expect(rows[1]).toHaveTextContent('+$1,000.00')
    expect(rows[1]).toHaveTextContent('Reparación del coche')
    expect(rows[2]).toHaveTextContent('Cena de cumpleaños')
    expect(rows[2]).toHaveTextContent('saldo $500.00')
    expect(screen.getByText('Te debe ahora')).toBeInTheDocument()
    expect(screen.getAllByText('$1,200.00').length).toBeGreaterThan(0)
  })

  it('says so when there is nothing yet, and while loading', () => {
    mocks.movements = { data: [], isLoading: false, isError: false }
    const { rerender } = render(<DebtHistory debt={emanuel} />)
    expect(screen.getByText('Todavía no hay movimientos.')).toBeInTheDocument()

    mocks.movements = { data: undefined, isLoading: true, isError: false }
    rerender(<DebtHistory debt={emanuel} />)
    expect(screen.getByText('Cargando el historial…')).toBeInTheDocument()
  })
})
