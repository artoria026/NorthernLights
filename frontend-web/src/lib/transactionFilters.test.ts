import { describe, expect, it } from 'vitest'
import type { Category, Transaction } from '@/types'
import { activeFilterCount, categoriesForType, matchesCategory, type FilterState } from './transactionFilters'

const cat = (id: string, type: 'income' | 'expense', parent_id: string | null = null) =>
  ({ id, type, parent_id, name: id }) as unknown as Category
const categories = [
  cat('comida', 'expense'),
  cat('restaurantes', 'expense', 'comida'),
  cat('cafe', 'expense', 'comida'),
  cat('mascotas', 'expense'),
  cat('empleo', 'income'),
]
const tx = (category_id: string | null) => ({ category_id }) as unknown as Transaction

describe('matchesCategory', () => {
  it('a parent category takes in its subcategories, a subcategory only itself', () => {
    expect(matchesCategory(tx('restaurantes'), 'comida', categories)).toBe(true)
    expect(matchesCategory(tx('comida'), 'comida', categories)).toBe(true)
    expect(matchesCategory(tx('restaurantes'), 'restaurantes', categories)).toBe(true)
    expect(matchesCategory(tx('cafe'), 'restaurantes', categories)).toBe(false)
    expect(matchesCategory(tx('mascotas'), 'comida', categories)).toBe(false)
  })

  it('no category chosen matches everything, and uncategorized rows only match that', () => {
    expect(matchesCategory(tx('mascotas'), '', categories)).toBe(true)
    expect(matchesCategory(tx(null), '', categories)).toBe(true)
    expect(matchesCategory(tx(null), 'comida', categories)).toBe(false)
  })
})

describe('categoriesForType', () => {
  it('offers the categories of the chosen kind of movement', () => {
    expect(categoriesForType(categories, 'EXPENSE').map((c) => c.id)).toEqual(['comida', 'restaurantes', 'cafe', 'mascotas'])
    expect(categoriesForType(categories, 'INCOME').map((c) => c.id)).toEqual(['empleo'])
    expect(categoriesForType(categories, 'ALL')).toHaveLength(5)
    expect(categoriesForType(categories, 'TRANSFER')).toEqual([])
  })
})

describe('activeFilterCount', () => {
  const clean: FilterState = {
    search: '',
    account: 'all',
    entryType: 'all',
    category: '',
    tag: 'all',
    dateFrom: '',
    dateTo: '',
    type: 'ALL',
  }

  it('is zero with everything clear and counts each narrowing filter once', () => {
    expect(activeFilterCount(clean)).toBe(0)
    expect(activeFilterCount({ ...clean, search: '   ' })).toBe(0)
    expect(activeFilterCount({ ...clean, search: 'sushi', category: 'comida', type: 'EXPENSE' })).toBe(3)
    expect(
      activeFilterCount({ search: 'x', account: 'a', entryType: 'expense', category: 'c', tag: 't', dateFrom: '2026-01-01', dateTo: '2026-02-01', type: 'INCOME' }),
    ).toBe(8)
  })
})
