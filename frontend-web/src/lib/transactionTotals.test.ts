import { describe, expect, it } from 'vitest'
import type { EntryType, Transaction } from '@/types'
import { summarizeTransactions } from './transactionTotals'

const tx = (entry_type: EntryType, amount: string | null): Transaction => ({ entry_type, amount }) as Transaction

describe('summarizeTransactions', () => {
  it('adds up each kind apart and the net of income minus expenses', () => {
    const totals = summarizeTransactions([
      tx('income', '1000.00'),
      tx('income', '250.50'),
      tx('expense', '300'),
      tx('expense', '99.50'),
      tx('transfer', '500'),
    ])
    expect(totals.income).toEqual({ count: 2, total: 1250.5 })
    expect(totals.expense).toEqual({ count: 2, total: 399.5 })
    expect(totals.transfer).toEqual({ count: 1, total: 500 })
    expect(totals.net).toBe(851)
    expect(totals.count).toBe(5)
  })

  it('counts loans and adjustments with the transfers, not as income or expense', () => {
    const totals = summarizeTransactions([tx('loan_given', '100'), tx('adjustment_in', '20'), tx('adjustment_out', '5')])
    expect(totals.transfer).toEqual({ count: 3, total: 125 })
    expect(totals.income.count + totals.expense.count).toBe(0)
  })

  it('treats a transaction without amount as zero and an empty list as all zeros', () => {
    expect(summarizeTransactions([tx('expense', null)]).expense).toEqual({ count: 1, total: 0 })
    const empty = summarizeTransactions([])
    expect([empty.count, empty.net, empty.income.total, empty.expense.total]).toEqual([0, 0, 0, 0])
  })
})
