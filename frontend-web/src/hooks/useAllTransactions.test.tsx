import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAllTransactions } from './useTransactions'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/services/api', () => ({ api: { get: mocks.get } }))

const row = (id: number) => ({ id: String(id) })
const page = (ids: number[], total: number, pageNumber: number) => ({
  data: { data: ids.map(row), meta: { total, page: pageNumber, per_page: 500 } },
})

let client: QueryClient
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  mocks.get.mockReset()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

describe('useAllTransactions', () => {
  it('reads every page, not only the first 500', async () => {
    mocks.get.mockImplementation(async (_url: string, config: { params: { page: number } }) => {
      const { page: n } = config.params
      if (n === 1) return page([1, 2], 1203, 1)
      if (n === 2) return page([3], 1203, 2)
      return page([4], 1203, 3)
    })
    const { result } = renderHook(() => useAllTransactions(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mocks.get).toHaveBeenCalledTimes(3) // 1,203 rows = 3 pages of 500
    expect(result.current.data?.data.map((t) => (t as unknown as { id: string }).id)).toEqual(['1', '2', '3', '4'])
  })

  it('asks for a single page when everything fits in it', async () => {
    mocks.get.mockResolvedValue(page([1, 2, 3], 3, 1))
    const { result } = renderHook(() => useAllTransactions(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mocks.get).toHaveBeenCalledTimes(1)
    expect(result.current.data?.data).toHaveLength(3)
  })

  it('works with no transactions at all', async () => {
    mocks.get.mockResolvedValue(page([], 0, 1))
    const { result } = renderHook(() => useAllTransactions(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data).toEqual([])
  })
})
