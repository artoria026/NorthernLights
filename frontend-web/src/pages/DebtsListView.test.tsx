import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Debt } from '@/types'
import { DebtsList, DebtsViewToggle } from './Debts'

const mocks = vi.hoisted(() => ({ saved: [] as unknown[], listedDirections: [] as string[] }))

vi.mock('@/hooks/useAccounts', () => ({ useAccounts: () => ({ data: [] }) }))
vi.mock('@/hooks/useAuth', () => ({
  useUpdateSettings: () => ({ mutate: (input: unknown) => mocks.saved.push(input) }),
}))
vi.mock('@/hooks/useDebts', () => ({
  useDeleteDebt: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDebtSummary: () => ({ data: undefined }),
  useUnplannedDebts: () => ({ data: [], isLoading: false }),
  useDebts: (direction: string) => {
    mocks.listedDirections.push(direction)
    return {
      isLoading: false,
      data: [
        {
          id: '1',
          name: 'George Reyes',
          direction,
          type: 'informal',
          status: 'active',
          total_amount: '13000.00',
          current_balance: '13000.00',
          interest_rate: '0',
          payment_amount: null,
        },
        {
          id: '9',
          name: 'Joshua Lechuga',
          direction,
          type: 'informal',
          status: 'completed',
          total_amount: '3000.00',
          current_balance: '0.00',
          interest_rate: '0',
          payment_amount: null,
        },
      ],
    }
  },
  useCreateDebt: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
  useCreateUnplannedDebt: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
  useActivateUnplannedDebt: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
  useDebtMovements: () => ({ data: [], isLoading: false, isError: false }),
  useIncreaseDebt: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
  useRegisterDebtPayment: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
  useUpdateDebt: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
}))

const debt = (partial: Partial<Debt> & { id: string; name: string }): Debt =>
  ({
    direction: 'owed_to_me',
    type: 'informal',
    status: 'active',
    total_amount: '0',
    current_balance: '0',
    interest_rate: '0',
    payment_amount: null,
    ...partial,
  }) as Debt

afterEach(() => {
  mocks.saved.length = 0
  mocks.listedDirections.length = 0
})

describe('DebtsList', () => {
  const debts = [
    debt({ id: '1', name: 'George Reyes', total_amount: '13000.00', current_balance: '13000.00' }),
    debt({ id: '2', name: 'Franco Andrade', total_amount: '15000.00', current_balance: '10000.00' }),
  ]

  it('shows one row per person with what was lent, collected and still owed', () => {
    render(<DebtsList debts={debts} />)
    const rows = screen.getAllByTestId('debt-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('George Reyes')
    expect(rows[0]).toHaveTextContent('0%')
    expect(rows[1]).toHaveTextContent('Franco Andrade')
    expect(rows[1]).toHaveTextContent('$15,000.00') // lent
    expect(rows[1]).toHaveTextContent('$5,000.00') // collected
    expect(rows[1]).toHaveTextContent('$10,000.00') // owes you
    expect(rows[1]).toHaveTextContent('33%')
    // the same actions as the card
    expect(within(rows[1]).getByRole('button', { name: /Historial/ })).toBeInTheDocument()
    expect(within(rows[1]).getByRole('button', { name: /Prestar más/ })).toBeInTheDocument()
    expect(within(rows[1]).getByRole('button', { name: /Cobrar/ })).toBeInTheDocument()
  })

  it('adds up the people at the bottom', () => {
    render(<DebtsList debts={debts} />)
    const list = screen.getByTestId('debts-list')
    expect(list).toHaveTextContent('2 personas')
    expect(list).toHaveTextContent('Prestado $28,000.00')
    expect(list).toHaveTextContent('Te debe $23,000.00')
  })
})

describe('Debt with interest', () => {
  it('shows what was lent, what will be paid and the interest, only when it has them', () => {
    const loan = debt({
      id: '5',
      name: 'Préstamo nómina Santander',
      direction: 'owed_by_me',
      original_amount: '50000.00',
      total_amount: '98700.00',
      current_balance: '76000.00',
    })
    const plain = debt({ id: '6', name: 'Sin intereses', total_amount: '1000.00', current_balance: '1000.00' })
    render(<DebtsList debts={[loan, plain]} />)
    const rows = screen.getAllByTestId('debt-row')
    expect(within(rows[0]).getByTestId('debt-terms')).toHaveTextContent(
      'Prestado $50,000.00 · A pagar $98,700.00 · Intereses $48,700.00',
    )
    expect(within(rows[1]).queryByTestId('debt-terms')).not.toBeInTheDocument()
  })
})

describe('DebtsViewToggle', () => {
  it('marks the chosen view and reports the change', () => {
    const onChange = vi.fn()
    render(<DebtsViewToggle value="cards" onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Tarjetas' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Lista' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Lista' }))
    expect(onChange).toHaveBeenCalledWith('list')
  })
})

describe('Debts screen preferences', () => {
  it('opens on the view and tab saved on the account, and saves each change', async () => {
    localStorage.setItem('nl:tour-seen:debts', '1') // no welcome dialog over the screen
    const { Debts } = await import('./Debts')
    const { MemoryRouter } = await import('react-router-dom')
    const { useAuthStore } = await import('@/stores/authStore')
    useAuthStore.setState({
      user: { debts_view: 'list', debts_direction: 'owed_to_me', debt_trouble_mode: false } as never,
    })
    render(
      <MemoryRouter>
        <Debts />
      </MemoryRouter>,
    )
    // list view and the "me deben" tab, straight from the account
    expect(await screen.findByTestId('debts-list')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lista' })).toHaveAttribute('aria-pressed', 'true')
    expect(mocks.listedDirections).toContain('owed_to_me')

    fireEvent.click(screen.getByRole('button', { name: 'Tarjetas' }))
    expect(mocks.saved).toContainEqual({ debts_view: 'cards' })
    expect(screen.queryByTestId('debts-list')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Yo debo' }))
    expect(mocks.saved).toContainEqual({ debts_direction: 'owed_by_me' })
  })
})

describe('Paid-off debts', () => {
  it('stay out of the active list but can be opened to see their history or lend again', async () => {
    localStorage.setItem('nl:tour-seen:debts', '1')
    const { Debts } = await import('./Debts')
    const { MemoryRouter } = await import('react-router-dom')
    const { useAuthStore } = await import('@/stores/authStore')
    useAuthStore.setState({
      user: { debts_view: 'list', debts_direction: 'owed_to_me', debt_trouble_mode: false } as never,
    })
    render(
      <MemoryRouter>
        <Debts />
      </MemoryRouter>,
    )
    const active = await screen.findByTestId('debts-list')
    expect(active).toHaveTextContent('George Reyes')
    expect(active).not.toHaveTextContent('Joshua Lechuga')

    const section = screen.getByTestId('completed-debts')
    expect(section).toHaveTextContent('Pagadas (1)')
    expect(section).not.toHaveTextContent('Joshua Lechuga') // closed until asked

    fireEvent.click(within(section).getByRole('button', { name: /Pagadas/ }))
    expect(section).toHaveTextContent('Joshua Lechuga')
    expect(within(section).getByRole('button', { name: /Historial/ })).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: /Prestar más/ })).toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: /Cobrar/ })).not.toBeInTheDocument()
  })
})
