import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from './authStore'

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.getState().logout()
    localStorage.clear()
  })

  it('starts logged out', () => {
    const state = useAuthStore.getState()
    expect(state.accessToken).toBeNull()
    expect(state.refreshToken).toBeNull()
    expect(state.user).toBeNull()
  })

  it('setTokens stores both access and refresh tokens', () => {
    useAuthStore.getState().setTokens('access-123', 'refresh-456')
    const state = useAuthStore.getState()
    expect(state.accessToken).toBe('access-123')
    expect(state.refreshToken).toBe('refresh-456')
  })

  it('setAccessToken only rotates the access token', () => {
    useAuthStore.getState().setTokens('access-1', 'refresh-1')
    useAuthStore.getState().setAccessToken('access-2')
    const state = useAuthStore.getState()
    expect(state.accessToken).toBe('access-2')
    expect(state.refreshToken).toBe('refresh-1')
  })

  it('logout clears tokens and user', () => {
    useAuthStore.getState().setTokens('a', 'b')
    useAuthStore.getState().setUser({
      id: '1',
      email: 'x@example.com',
      name: 'X',
      avatar_url: null,
      role: 'user',
      auth_provider: 'email',
      theme: 'dark',
      email_notifications: true,
      push_notifications: true,
      pay_cycle: 'monthly',
      debt_trouble_mode: false,
      last_seen_changelog_version: null,
      accepted_disclaimer_version: null,
      current_disclaimer_version: '1',
      created_at: '2026-01-01',
    })
    useAuthStore.getState().logout()
    const state = useAuthStore.getState()
    expect(state.accessToken).toBeNull()
    expect(state.refreshToken).toBeNull()
    expect(state.user).toBeNull()
  })
})
