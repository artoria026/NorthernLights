import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Category, Transaction } from '@/types'
import { Transactions } from './Transactions'

const cat = (id: string, name: string, type: 'income' | 'expense', parent_id: string | null = null) =>
  ({ id, name, type, parent_id, color: '#6366F1', icon: null }) as unknown as Category

const categories = [
  cat('comida', 'Comida y Bebidas', 'expense'),
  cat('restaurantes', 'Restaurantes y calle', 'expense', 'comida'),
  cat('cafe', 'Café y antojos', 'expense', 'comida'),
  cat('mascotas', 'Mascotas', 'expense'),
  cat('empleo', 'Empleo principal', 'income'),
]

const tx = (id: string, description: string, category_id: string, entry_type: 'income' | 'expense', amount: string) =>
  ({
    id,
    date: '2026-10-10',
    description,
    notes: null,
    tags: [],
    amount,
    entry_type,
    category_id,
    category_name: null,
    status: 'confirmed',
    is_recurring: false,
    created_at: '',
    lines: [],
    installment: null,
  }) as unknown as Transaction

const transactions = [
  tx('1', 'Cena sushi', 'restaurantes', 'expense', '300'),
  tx('2', 'Capuchino', 'cafe', 'expense', '60'),
  tx('3', 'Croquetas', 'mascotas', 'expense', '200'),
  tx('4', 'Nómina', 'empleo', 'income', '1000'),
]

vi.mock('@/hooks/useAccounts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useAccounts')>()),
  useAccounts: () => ({ data: [] }),
}))
vi.mock('@/hooks/useCategories', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useCategories')>()),
  useCategories: () => ({ data: categories }),
}))
vi.mock('@/hooks/useDebts', () => ({ useDebts: () => ({ data: [] }) }))
vi.mock('@/hooks/useTags', () => ({
  useTags: () => ({ data: [] }),
  useBulkTag: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/usePageSize', () => ({ usePageSize: () => [50, vi.fn()], PAGE_SIZE_OPTIONS: [10, 20, 50] }))
vi.mock('@/hooks/useTransactions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useTransactions')>()),
  useAllTransactions: () => ({ data: { data: transactions, meta: { total: 4 } }, isLoading: false, isError: false }),
  useDeleteTransaction: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateSplitExpense: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
}))
vi.mock('@/components/nl/TransactionsCalendar', () => ({ TransactionsCalendar: () => null }))

function renderPage() {
  localStorage.setItem('nl:tour-seen:transactions', '1')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Transactions />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => localStorage.clear())

describe('Transactions filters', () => {
  it('has no clear button until something narrows the list', () => {
    renderPage()
    expect(screen.queryByTestId('clear-filters')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Buscar'), { target: { value: 'sushi' } })
    expect(screen.getByTestId('clear-filters')).toHaveTextContent('Limpiar filtro')
  })

  it('counts the active filters and clears all of them with one click', () => {
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('Buscar'), { target: { value: 'sushi' } })
    fireEvent.click(screen.getByRole('button', { name: 'GASTO' }))
    expect(screen.getByTestId('clear-filters')).toHaveTextContent('Limpiar filtros (2)')
    expect(screen.queryAllByText('Nómina')).toHaveLength(0)

    fireEvent.click(screen.getByTestId('clear-filters'))
    expect(screen.queryByTestId('clear-filters')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Buscar')).toHaveValue('')
    expect(screen.getAllByText('Nómina').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Croquetas').length).toBeGreaterThan(0)
  })

  it('offers the categories with their subcategories, and only those of the chosen kind', () => {
    renderPage()
    fireEvent.click(within(screen.getByTestId('category-filter')).getByRole('combobox', { name: 'Todas las categorías' }))
    expect(screen.getByText('Empleo principal')).toBeInTheDocument()
    expect(screen.getByText('Restaurantes y calle')).toBeInTheDocument()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
  })

  it('filters by a subcategory (only it) or by a category (it and all its subcategories)', () => {
    renderPage()
    const open = () =>
      fireEvent.click(within(screen.getByTestId('category-filter')).getByRole('combobox', { name: /categorías|Comida|Café|Restaurantes/ }))

    open()
    fireEvent.click(screen.getByRole('option', { name: /Café y antojos/ }))
    expect(screen.getAllByText('Capuchino').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('Cena sushi')).toHaveLength(0)
    expect(screen.queryAllByText('Croquetas')).toHaveLength(0)
    expect(screen.getByTestId('clear-filters')).toHaveTextContent('Limpiar filtro')

    // the parent ("General" inside its group) takes in both of its subcategories
    open()
    fireEvent.click(screen.getAllByRole('option', { name: /General/ })[0])
    expect(screen.getAllByText('Capuchino').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Cena sushi').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('Croquetas')).toHaveLength(0)
    expect(screen.queryAllByText('Nómina')).toHaveLength(0)

    // clearing the category alone brings everything back
    fireEvent.click(screen.getByRole('button', { name: 'Quitar la categoría' }))
    expect(screen.getAllByText('Croquetas').length).toBeGreaterThan(0)
  })
})
