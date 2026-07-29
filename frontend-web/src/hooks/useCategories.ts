import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import { patchAllListQueries, patchMatchingListQueries } from '@/lib/queryCache'
import type { ApiSuccess, Category } from '@/types'

/** `['categories', type]` puede tener variantes 'all'/'income'/'expense'
 * cacheadas simultaneamente (ej. un selector de categorias de gasto en un
 * formulario, y la pagina de Categorias mostrando todas). */
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
      // UpdateCategoryInput no incluye `type`, asi que el campo de filtro
      // nunca cambia -- actualizar in-place en todas las variantes es seguro.
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

/** Categorias de sistema que el usuario actual desactivo -- para la seccion
 * de "reactivar". Las propias nunca aparecen aca (esas se eliminan). */
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

/** Oculta una categoria de sistema solo para el usuario actual (reversible) --
 * nunca aplica a categorias propias, esas se eliminan con useDeleteCategory. */
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

/** Cuanto lleva cada categoria (ingreso o gasto) en el mes dado. Sin year/month
 * el backend usa el mes actual. */
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
