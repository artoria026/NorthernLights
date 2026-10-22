import type { Category, Transaction } from '@/types'

/** Whether a transaction belongs to the chosen category. Choosing a parent category also takes in
 * every one of its subcategories (that is what "Comida y Bebidas" means to the user); choosing a
 * subcategory takes in only that one. An empty id means "any category". */
export function matchesCategory(tx: Transaction, categoryId: string, categories: Category[]): boolean {
  if (!categoryId) return true
  if (!tx.category_id) return false
  if (tx.category_id === categoryId) return true
  const own = categories.find((c) => c.id === tx.category_id)
  return own?.parent_id === categoryId
}

/** The categories the category filter offers: those of the chosen kind of movement. Income and
 * expense categories both show when nothing narrows it down; transfers have no categories. */
export function categoriesForType(categories: Category[], type: 'ALL' | 'INCOME' | 'EXPENSE' | 'TRANSFER'): Category[] {
  if (type === 'INCOME') return categories.filter((c) => c.type === 'income')
  if (type === 'EXPENSE') return categories.filter((c) => c.type === 'expense')
  if (type === 'TRANSFER') return []
  return categories
}

export interface FilterState {
  search: string
  account: string
  entryType: string
  category: string
  tag: string
  dateFrom: string
  dateTo: string
  type: 'ALL' | 'INCOME' | 'EXPENSE' | 'TRANSFER'
}

/** How many filters are narrowing the list right now ("all" / "" / ALL mean not filtering). */
export function activeFilterCount(f: FilterState): number {
  return [
    f.search.trim() !== '',
    f.account !== 'all',
    f.entryType !== 'all',
    f.category !== '',
    f.tag !== 'all',
    f.dateFrom !== '',
    f.dateTo !== '',
    f.type !== 'ALL',
  ].filter(Boolean).length
}
