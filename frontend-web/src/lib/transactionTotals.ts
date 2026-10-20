import type { Transaction } from '@/types'

export interface TypeTotal {
  count: number
  total: number
}

export interface TransactionTotals {
  income: TypeTotal
  expense: TypeTotal
  /** Transfers, loans and adjustments: everything that is neither income nor expense
   * (the same bucket the TRANSFER filter of the list shows). */
  transfer: TypeTotal
  /** Income minus expenses. */
  net: number
  count: number
}

/** Totals of the transactions given, by kind. The list passes ALL the rows its filters
 * leave (not just the page being shown), so the figures always match what is filtered. */
export function summarizeTransactions(transactions: Transaction[]): TransactionTotals {
  const totals: TransactionTotals = {
    income: { count: 0, total: 0 },
    expense: { count: 0, total: 0 },
    transfer: { count: 0, total: 0 },
    net: 0,
    count: transactions.length,
  }
  for (const tx of transactions) {
    const bucket =
      tx.entry_type === 'income' ? totals.income : tx.entry_type === 'expense' ? totals.expense : totals.transfer
    bucket.count += 1
    bucket.total += Number(tx.amount ?? 0)
  }
  totals.net = totals.income.total - totals.expense.total
  return totals
}
