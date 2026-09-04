import type { QueryClient, QueryKey } from '@tanstack/react-query'

/**
 * Applies `updater` to all cached queries whose key starts with
 * `keyPrefix` AND for which `matches(queryKey)` is true. Used for filtered
 * lists (e.g. `['recurring', 'list', status, item_type]`) where inserting a
 * new item should only affect the variants whose filter would include it --
 * unlike `setQueryData`, which can only target one exact key.
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

/** Same as `patchMatchingListQueries` but without a filter -- updates
 * in-place (map/filter by id) any cached variant that exists, regardless
 * of whether the modified item still matches that variant's filter. Safe
 * for changes to fields other than the filter field itself. */
export function patchAllListQueries<T>(
  queryClient: QueryClient,
  keyPrefix: QueryKey,
  updater: (old: T[] | undefined) => T[] | undefined,
): void {
  patchMatchingListQueries(queryClient, keyPrefix, () => true, updater)
}
