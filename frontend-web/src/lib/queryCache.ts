import type { QueryClient, QueryKey } from '@tanstack/react-query'

/**
 * Aplica `updater` a todas las queries cacheadas cuya key empieza con
 * `keyPrefix` Y para las que `matches(queryKey)` es true. Usado para listas
 * filtradas (ej. `['recurring', 'list', status, item_type]`) donde insertar
 * un item nuevo solo debe afectar las variantes cuyo filtro lo incluiria --
 * a diferencia de `setQueryData`, que solo puede apuntar a una key exacta.
 */
export function patchMatchingListQueries<T>(
  queryClient: QueryClient,
  keyPrefix: QueryKey,
  matches: (queryKey: QueryKey) => boolean,
  updater: (old: T[] | undefined) => T[] | undefined,
): void {
  const queries = queryClient.getQueryCache().findAll({ queryKey: keyPrefix })
  for (const query of queries) {
    if (matches(query.queryKey)) {
      queryClient.setQueryData<T[]>(query.queryKey, updater)
    }
  }
}

/** Igual que `patchMatchingListQueries` pero sin filtro -- actualiza in-place
 * (map/filter por id) cualquier variante cacheada que exista, sin importar
 * si el item modificado todavia encaja con el filtro de esa variante. Seguro
 * para cambios de campos que no sean el propio campo de filtro. */
export function patchAllListQueries<T>(
  queryClient: QueryClient,
  keyPrefix: QueryKey,
  updater: (old: T[] | undefined) => T[] | undefined,
): void {
  patchMatchingListQueries(queryClient, keyPrefix, () => true, updater)
}
