import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TransactionsCalendar, heatLevel } from './TransactionsCalendar'

const mocks = vi.hoisted(() => ({
  transactions: [] as unknown[],
  recurring: [] as unknown[],
}))
vi.mock('@/hooks/useTransactions', () => ({ useTransactions: () => ({ data: { data: mocks.transactions } }) }))
vi.mock('@/hooks/useRecurring', () => ({ useRecurringItems: () => ({ data: mocks.recurring }) }))
vi.mock('@/hooks/useDebts', () => ({ useDebts: () => ({ data: [] }) }))

const month = new Date().toISOString().slice(0, 8) // "YYYY-MM-"
const day = (n: number) => `${month}${String(n).padStart(2, '0')}`
const cell = (n: number) => document.querySelector<HTMLElement>(`[data-day="${day(n)}"]`)!

const onSelectRange = vi.fn()
beforeEach(() => {
  onSelectRange.mockReset()
  mocks.transactions = []
  mocks.recurring = []
})

function setup(selected: { from: string; to: string } | null = null) {
  return render(<TransactionsCalendar selectedRange={selected} onSelectRange={onSelectRange} />)
}

describe('TransactionsCalendar range selection', () => {
  it('a press and release on one day selects just that day', () => {
    setup()
    fireEvent.pointerDown(cell(10), { button: 0 })
    fireEvent.pointerUp(window)
    expect(onSelectRange).toHaveBeenCalledWith({ from: day(10), to: day(10) })
  })

  it('pressing a day and dragging over others selects the whole range, only when released', () => {
    setup()
    fireEvent.pointerDown(cell(10), { button: 0 })
    fireEvent.pointerEnter(cell(11))
    fireEvent.pointerEnter(cell(13))
    expect(onSelectRange).not.toHaveBeenCalled() // still dragging: the filter does not move yet
    fireEvent.pointerUp(window)
    expect(onSelectRange).toHaveBeenCalledWith({ from: day(10), to: day(13) })
  })

  it('dragging backwards (to an earlier day) still gives the range in order', () => {
    setup()
    fireEvent.pointerDown(cell(20), { button: 0 })
    fireEvent.pointerEnter(cell(17))
    fireEvent.pointerUp(window)
    expect(onSelectRange).toHaveBeenCalledWith({ from: day(17), to: day(20) })
  })

  it('shows the range while it is being dragged', () => {
    setup()
    fireEvent.pointerDown(cell(10), { button: 0 })
    fireEvent.pointerEnter(cell(12))
    expect([10, 11, 12].every((n) => cell(n).getAttribute('aria-pressed') === 'true')).toBe(true)
    expect(cell(13).getAttribute('aria-pressed')).toBe('false')
    fireEvent.pointerUp(window)
  })

  it('pressing the day that is the only one selected clears the filter', () => {
    setup({ from: day(10), to: day(10) })
    fireEvent.pointerDown(cell(10), { button: 0 })
    fireEvent.pointerUp(window)
    expect(onSelectRange).toHaveBeenCalledWith(null)
  })

  it('ignores moving the pointer over days when nothing is pressed', () => {
    setup()
    fireEvent.pointerEnter(cell(12))
    fireEvent.pointerUp(window)
    expect(onSelectRange).not.toHaveBeenCalled()
  })

  it('marks the selected range that comes from the filter and offers to clear it', () => {
    setup({ from: day(5), to: day(7) })
    expect([5, 6, 7].every((n) => cell(n).getAttribute('aria-pressed') === 'true')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Quitar filtro de fecha/ }))
    expect(onSelectRange).toHaveBeenCalledWith(null)
  })
})


describe('heatLevel', () => {
  it('goes from nothing to a lot as the day spends more', () => {
    expect([0, 1, 199.99, 200, 499.99, 500, 1499.99, 1500, 9000].map(heatLevel)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4])
  })
})

describe('TransactionsCalendar "calor de cristal" marks', () => {
  const tx = (n: number, entry_type: string, amount: string) => ({
    date: day(n),
    entry_type,
    amount,
    status: 'confirmed',
  })

  it('tints each day by what was spent and flags the days with income', () => {
    mocks.transactions = [tx(3, 'expense', '120'), tx(4, 'expense', '600'), tx(4, 'expense', '50'), tx(5, 'income', '1000')]
    setup()
    expect(cell(2).dataset.heat).toBe('0')
    expect(cell(3).dataset.heat).toBe('1')
    expect(cell(4).dataset.heat).toBe('3') // 650 in total that day
    expect(cell(5).dataset.heat).toBe('0')
    expect(cell(5).dataset.income).toBe('true')
    expect(cell(3).dataset.income).toBeUndefined()
  })

  it('ignores rejected transactions', () => {
    mocks.transactions = [{ ...tx(6, 'expense', '900'), status: 'rejected' }]
    setup()
    expect(cell(6).dataset.heat).toBe('0')
  })

  it('flags the days with an upcoming payment', () => {
    mocks.recurring = [
      { status: 'active', name: 'Renta', amount: '5000', frequency: 'monthly', next_date: day(24) },
    ]
    setup()
    expect(cell(24).dataset.upcoming).toBe('true')
    expect(cell(23).dataset.upcoming).toBeUndefined()
  })
})
