import { describe, expect, it } from 'vitest'
import type { Transaction } from '@/types'
import { activeInstallmentPlans, lastCycleBoundary, openCycleCharges, remainingOfPlan } from './cardCommitments'

function tx(partial: Partial<Transaction> & { id: string }): Transaction {
  return {
    date: '2026-10-01',
    description: partial.id,
    notes: null,
    tags: [],
    amount: '100',
    entry_type: 'expense',
    category_id: null,
    category_name: null,
    status: 'confirmed',
    is_recurring: false,
    created_at: '',
    lines: [],
    installment: null,
    ...partial,
  } as Transaction
}

const plan = (paid: number, total: number, monthly = '170.47') => ({
  total_installments: total,
  paid_installments: paid,
  monthly_amount: monthly,
})

describe('lastCycleBoundary', () => {
  it('is this month cutoff when it already passed, or last month cutoff when it has not', () => {
    expect(lastCycleBoundary(27, new Date(2026, 9, 20))).toBe('2026-09-27')
    expect(lastCycleBoundary(27, new Date(2026, 9, 28))).toBe('2026-10-27')
    expect(lastCycleBoundary(27, new Date(2026, 0, 5))).toBe('2025-12-27')
  })

  it('clamps to the last day of short months', () => {
    expect(lastCycleBoundary(31, new Date(2026, 2, 10))).toBe('2026-02-28')
  })
})

describe('activeInstallmentPlans', () => {
  it('keeps the plans that still have installments, however old the purchase is', () => {
    const old = tx({ id: 'teclado', date: '2026-07-10', installment: plan(3, 12) })
    const done = tx({ id: 'listo', installment: plan(3, 3) })
    const normal = tx({ id: 'normal' })
    expect(activeInstallmentPlans([old, done, normal]).map((t) => t.id)).toEqual(['teclado'])
  })
})

describe('remainingOfPlan', () => {
  it('is installments left times the monthly amount', () => {
    expect(remainingOfPlan(tx({ id: 'a', installment: plan(3, 12, '170.47') }))).toBeCloseTo(1534.23, 2)
    expect(remainingOfPlan(tx({ id: 'b' }))).toBe(0)
  })
})

describe('openCycleCharges', () => {
  it('lists only plain expenses after the cutoff, newest first', () => {
    const rows = [
      tx({ id: 'viejo', date: '2026-09-20' }),
      tx({ id: 'a', date: '2026-10-06' }),
      tx({ id: 'b', date: '2026-10-16' }),
      tx({ id: 'meses', date: '2026-10-10', installment: plan(0, 3) }),
      tx({ id: 'pago', date: '2026-10-03', entry_type: 'transfer' }),
    ]
    expect(openCycleCharges(rows, '2026-09-27').map((t) => t.id)).toEqual(['b', 'a'])
  })

  it('is empty without a cutoff day', () => {
    expect(openCycleCharges([tx({ id: 'a' })], null)).toEqual([])
  })
})
