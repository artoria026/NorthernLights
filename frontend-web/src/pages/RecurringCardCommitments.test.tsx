import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, Transaction } from '@/types'
import { CreditCardCommitments } from './Recurring'

const mocks = vi.hoisted(() => ({ transactions: [] as unknown[] }))

vi.mock('@/hooks/useAccounts', () => ({
  useAccounts: () => ({ data: [] }),
  useTdcCycle: () => ({
    data: { billing_cycle_day: 27, payment_due_date: '2026-11-17' },
  }),
}))
vi.mock('@/hooks/useCategories', () => ({
  useCategories: () => ({ data: [{ id: 'comida', color: '#f5a623' }] }),
}))
vi.mock('@/hooks/useTransactions', () => ({
  useAllTransactions: () => ({ data: { data: mocks.transactions } }),
}))

const stori = { id: 'stori', name: 'Stori', color: '#00c47c' } as Account

function tx(partial: Record<string, unknown>) {
  return {
    entry_type: 'expense',
    installment: null,
    notes: null,
    tags: [],
    lines: [],
    ...partial,
  } as unknown as Transaction
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 20, 12))
  mocks.transactions = [
    // oldest purchase: a plan that would fall out of any "latest 50" window
    tx({
      id: 'teclado',
      date: '2026-07-10',
      description: 'Teclado mecánico EPOMAKER TH108 Pro',
      amount: '2045.67',
      installment: { total_installments: 12, paid_installments: 3, monthly_amount: '170.47' },
    }),
    tx({
      id: 'horno',
      date: '2026-08-15',
      description: 'Horno de microondas Midea 30 L',
      amount: '1999.00',
      installment: { total_installments: 6, paid_installments: 2, monthly_amount: '333.17' },
    }),
    tx({ id: 'mandado', date: '2026-10-06', description: 'Mandado', amount: '1397.00' }),
    tx({ id: 'cafe', date: '2026-10-16', description: 'Café Caffenio - Salida con Mireya', amount: '144.00' }),
    tx({ id: 'viejo', date: '2026-09-20', description: 'Compra del ciclo anterior', amount: '500.00' }),
  ]
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CreditCardCommitments', () => {
  it('sums the plans of any age and the open cycle, in the collapsed row', () => {
    render(<CreditCardCommitments creditCards={[stori]} />)
    // 170.47 + 333.17 = 503.64 in installments; 1,397 + 144 = 1,541 in the open cycle
    // the total shows in the card header and in the Stori row
    expect(screen.getAllByText('$2,044.64')).toHaveLength(2)
    expect(screen.queryByTestId('card-commitment-detail')).not.toBeInTheDocument()
  })

  it('shows what is behind the numbers when the card is opened', () => {
    render(<CreditCardCommitments creditCards={[stori]} />)
    fireEvent.click(screen.getByRole('button', { name: /Stori/ }))

    const detail = screen.getByTestId('card-commitment-detail')
    expect(detail).toHaveTextContent('Teclado mecánico EPOMAKER TH108 Pro')
    expect(detail).toHaveTextContent('3 de 12 pagadas')
    expect(detail).toHaveTextContent('Último corte: 27 sep')
    expect(detail).toHaveTextContent('Fecha límite de pago: 17 nov')
    expect(detail).toHaveTextContent('Horno de microondas Midea 30 L')
    expect(detail).toHaveTextContent('2 de 6 pagadas')
    // 9 installments left of 170.47 = 1,534.23
    expect(detail).toHaveTextContent('faltan $1,534.23')
    expect(detail).toHaveTextContent('Mandado')
    expect(detail).toHaveTextContent('Café Caffenio - Salida con Mireya')
    // a purchase before the cutoff doesn't belong to the open cycle
    expect(detail).not.toHaveTextContent('Compra del ciclo anterior')
  })
})
