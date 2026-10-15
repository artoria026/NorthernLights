import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, usePageSize } from './usePageSize'

beforeEach(() => localStorage.clear())

describe('usePageSize', () => {
  it('starts at 20 and offers 10 up to 500', () => {
    const { result } = renderHook(() => usePageSize('transactions'))
    expect(result.current[0]).toBe(DEFAULT_PAGE_SIZE)
    expect(DEFAULT_PAGE_SIZE).toBe(20)
    expect([PAGE_SIZE_OPTIONS[0], PAGE_SIZE_OPTIONS.at(-1)]).toEqual([10, 500])
  })

  it('remembers the choice per screen', () => {
    const first = renderHook(() => usePageSize('transactions'))
    act(() => first.result.current[1](100))
    expect(renderHook(() => usePageSize('transactions')).result.current[0]).toBe(100)
    expect(renderHook(() => usePageSize('admin-users')).result.current[0]).toBe(20)
  })

  it('ignores a stored value that is not an option', () => {
    localStorage.setItem('nl-page-size:transactions', '9999')
    expect(renderHook(() => usePageSize('transactions')).result.current[0]).toBe(20)
  })
})
