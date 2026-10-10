import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LAST_ACTIVITY_KEY, LOGOUT_REASON_KEY, reportActivity } from '@/lib/sessionTimeout'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import { useSessionTimeout } from './useSessionTimeout'

vi.mock('@/services/api', () => ({ api: { post: vi.fn() } }))

const MIN = 60_000
const post = vi.mocked(api.post)

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
}

function mount() {
  return renderHook(() => useSessionTimeout(), { wrapper })
}

/** Time passes without anyone touching anything. */
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('useSessionTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-10T12:00:00Z'))
    localStorage.clear()
    post.mockReset()
    post.mockResolvedValue({ data: { data: { idle_timeout_seconds: 600 } } })
    useAuthStore.setState({
      accessToken: 'access',
      refreshToken: 'refresh',
      idleTimeoutSeconds: 600,
      user: null,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays quiet while the person is active, then counts down the last 60 seconds', () => {
    const { result } = mount()
    advance(8 * MIN)
    expect(result.current.remainingSeconds).toBeNull()

    advance(MIN + 1_000) // 9:01 idle -> 59 s left
    expect(result.current.remainingSeconds).toBe(59)
    advance(30_000)
    expect(result.current.remainingSeconds).toBe(29)
  })

  it('signs out at the limit: revokes on the server, clears the session, remembers why', async () => {
    mount()
    advance(10 * MIN + 1_000)
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    expect(post).toHaveBeenCalledWith('/auth/logout', { refresh_token: 'refresh' })
    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(localStorage.getItem(LOGOUT_REASON_KEY)).toBe('idle')
  })

  it('real input before the warning resets the clock', () => {
    const { result } = mount()
    advance(8 * MIN)
    act(() => {
      window.dispatchEvent(new Event('keydown'))
    })
    advance(8 * MIN) // 16 min since the start, but only 8 since the last input
    expect(result.current.remainingSeconds).toBeNull()
  })

  it('code-reported activity (an AI answer streaming in) also resets it', () => {
    const { result } = mount()
    advance(9 * MIN - 5_000)
    act(() => reportActivity())
    advance(MIN)
    expect(result.current.remainingSeconds).toBeNull()
  })

  it('stray input does not dismiss the warning: only the button does', () => {
    const { result } = mount()
    advance(9 * MIN + 5_000)
    expect(result.current.remainingSeconds).not.toBeNull()

    act(() => {
      window.dispatchEvent(new Event('pointerdown'))
      window.dispatchEvent(new Event('keydown'))
    })
    advance(1_000)
    expect(result.current.remainingSeconds).not.toBeNull()

    post.mockClear()
    act(() => result.current.stayConnected())
    expect(result.current.remainingSeconds).toBeNull()
    expect(post).toHaveBeenCalledWith('/auth/activity', { refresh_token: 'refresh' })

    advance(8 * MIN) // a fresh full window after confirming
    expect(result.current.remainingSeconds).toBeNull()
  })

  it('another tab\'s activity dismisses the warning here', () => {
    const { result } = mount()
    advance(9 * MIN + 5_000)
    expect(result.current.remainingSeconds).not.toBeNull()

    const at = Date.now()
    localStorage.setItem(LAST_ACTIVITY_KEY, String(at))
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: LAST_ACTIVITY_KEY, newValue: String(at) }))
    })
    expect(result.current.remainingSeconds).toBeNull()
  })

  it('tells the server about activity, at most once a minute', () => {
    mount()
    post.mockClear() // the mount ping
    act(() => {
      window.dispatchEvent(new Event('pointerdown'))
    })
    expect(post).not.toHaveBeenCalled() // just pinged on mount

    advance(61_000)
    act(() => {
      window.dispatchEvent(new Event('pointerdown'))
      window.dispatchEvent(new Event('pointerdown'))
    })
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('/auth/activity', { refresh_token: 'refresh' })
  })

  it('adopts the limit the server reports', async () => {
    useAuthStore.setState({ idleTimeoutSeconds: null })
    post.mockResolvedValue({ data: { data: { idle_timeout_seconds: 300 } } })
    mount()
    await act(async () => {
      await Promise.resolve()
    })
    expect(useAuthStore.getState().idleTimeoutSeconds).toBe(300)
  })

  it('treats a laptop that slept past the limit as expired right away', async () => {
    mount()
    vi.setSystemTime(Date.now() + 30 * MIN) // no ticks ran while it slept
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(useAuthStore.getState().accessToken).toBeNull()
  })
})
