import { useCallback, useState } from 'react'

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200, 500] as const
export const DEFAULT_PAGE_SIZE = 20

const storageKey = (screen: string) => `nl-page-size:${screen}`

function readStored(screen: string): number {
  try {
    const value = Number(localStorage.getItem(storageKey(screen)))
    return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value) ? value : DEFAULT_PAGE_SIZE
  } catch {
    return DEFAULT_PAGE_SIZE
  }
}

/** How many rows a screen's list shows per page: 20 by default, remembered per
 * screen in this browser (a private window or blocked storage just falls back to 20). */
export function usePageSize(screen: string) {
  const [pageSize, setPageSizeState] = useState(() => readStored(screen))
  const setPageSize = useCallback(
    (size: number) => {
      setPageSizeState(size)
      try {
        localStorage.setItem(storageKey(screen), String(size))
      } catch {
        // Not remembering the choice is fine.
      }
    },
    [screen],
  )
  return [pageSize, setPageSize] as const
}
