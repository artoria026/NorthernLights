import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import { patchAllListQueries, patchMatchingListQueries } from '@/lib/queryCache'
import type { ApiSuccess, Category } from '@/types'

/** `['categories', type]` can have 'all'/'income'/'expense' variants
 * cached simultaneously (e.g. an expense category selector in a
 * form, and the Categories page showing all of them). */
function matchesCategoryFilter(queryKey: unknown[], category: Category): boolean {
  const [, type] = queryKey
  return type === 'all' || type === category.type
}

export function useCategories(type?: 'income' | 'expense') {
  return useQuery({
    queryKey: ['categories', type ?? 'all'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<Category[]>>('/categories', {
        params: type ? { type } : undefined,
      })
      return data.data
    },
  })
}

export interface CreateCategoryInput {
  name: string
  type: 'income' | 'expense'
  icon?: string
  color?: string
  parent_id?: string
}

export function useCreateCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateCategoryInput) => {
      const { data } = await api.post<ApiSuccess<Category>>('/categories', input)
      return data.data
    },
    onSuccess: (category) => {
      patchMatchingListQueries<Category>(
        queryClient,
        ['categories'],
        (key) => key.length === 2 && matchesCategoryFilter(key as unknown[], category),
        (prev) => [...(prev ?? []), category],
      )
    },
  })
}

export interface UpdateCategoryInput {
  name?: string
  icon?: string
  color?: string
}

export function useUpdateCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateCategoryInput }) => {
      const { data } = await api.put<ApiSuccess<Category>>(`/categories/${id}`, input)
      return data.data
    },
    onSuccess: (category) => {
      // UpdateCategoryInput doesn't include `type`, so the filter field
      // never changes -- updating in-place across all variants is safe.
      patchAllListQueries<Category>(queryClient, ['categories'], (prev) =>
        (prev ?? []).map((c) => (c.id === category.id ? category : c)),
      )
    },
  })
}

export function useDeleteCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/categories/${id}`)
      return id
    },
    onSuccess: (id) => {
      patchAllListQueries<Category>(queryClient, ['categories'], (prev) =>
        (prev ?? []).filter((c) => c.id !== id),
      )
    },
  })
}

/** System categories that the current user deactivated -- for the
 * "reactivate" section. Custom ones never appear here (those get deleted). */
export function useHiddenCategories(type?: 'income' | 'expense') {
  return useQuery({
    queryKey: ['categories', 'hidden', type ?? 'all'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<Category[]>>('/categories/hidden', {
        params: type ? { type } : undefined,
      })
      return data.data
    },
  })
}

/** Hides a system category only for the current user (reversible) --
 * never applies to custom categories, those get deleted with useDeleteCategory. */
export function useDeactivateCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<ApiSuccess<Category>>(`/categories/${id}/deactivate`)
      return data.data
    },
    onSuccess: (category) => {
      patchAllListQueries<Category>(queryClient, ['categories'], (prev) =>
        (prev ?? []).filter((c) => c.id !== category.id),
      )
      patchMatchingListQueries<Category>(
        queryClient,
        ['categories'],
        (key) => key[1] === 'hidden' && matchesCategoryFilter([key[0], key[2]], category),
        (prev) => [...(prev ?? []), category],
      )
    },
  })
}

export function useReactivateCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<ApiSuccess<Category>>(`/categories/${id}/reactivate`)
      return data.data
    },
    onSuccess: (category) => {
      patchMatchingListQueries<Category>(
        queryClient,
        ['categories'],
        (key) => key[1] === 'hidden',
        (prev) => (prev ?? []).filter((c) => c.id !== category.id),
      )
      patchMatchingListQueries<Category>(
        queryClient,
        ['categories'],
        (key) => key.length === 2 && matchesCategoryFilter(key as unknown[], category),
        (prev) => [...(prev ?? []), category],
      )
    },
  })
}

export interface CategorySummaryItem {
  category_id: string
  total: string
}

/** How much each category (income or expense) has accrued in the given month. Without
 * year/month the backend uses the current month. */
export function useCategorySummary(year?: number, month?: number) {
  return useQuery({
    queryKey: ['categories', 'summary', year ?? 'current', month ?? 'current'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<CategorySummaryItem[]>>('/categories/summary', {
        params: year && month ? { year, month } : undefined,
      })
      return data.data
    },
  })
}
