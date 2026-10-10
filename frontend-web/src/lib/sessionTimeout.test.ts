import { beforeEach, describe, expect, it } from 'vitest'
import {
  LIVENESS_GRACE_MS,
  LOGOUT_REASON_KEY,
  WARNING_SECONDS,
  consumeLogoutReason,
  getIdlePhase,
  setLogoutReason,
  shouldEndSessionOnBoot,
} from './sessionTimeout'

const TIMEOUT = 600 // seconds, the server default

describe('getIdlePhase', () => {
  it('is active until the warning window opens', () => {
    expect(getIdlePhase(0, TIMEOUT)).toEqual({ phase: 'active' })
    expect(getIdlePhase((TIMEOUT - WARNING_SECONDS) * 1000 - 1, TIMEOUT)).toEqual({ phase: 'active' })
  })

  it('warns for the last 60 seconds, with the seconds left', () => {
    expect(getIdlePhase((TIMEOUT - WARNING_SECONDS) * 1000, TIMEOUT)).toEqual({
      phase: 'warning',
      remainingSeconds: 60,
    })
    expect(getIdlePhase((TIMEOUT - 1) * 1000, TIMEOUT)).toEqual({ phase: 'warning', remainingSeconds: 1 })
  })

  it('rounds the remaining time up so 0:00 only shows at expiry', () => {
    expect(getIdlePhase(TIMEOUT * 1000 - 500, TIMEOUT)).toEqual({ phase: 'warning', remainingSeconds: 1 })
  })

  it('expires at the limit and after (e.g. a laptop that slept through it)', () => {
    expect(getIdlePhase(TIMEOUT * 1000, TIMEOUT)).toEqual({ phase: 'expired' })
    expect(getIdlePhase(TIMEOUT * 1000 * 5, TIMEOUT)).toEqual({ phase: 'expired' })
  })

  it('has no warning window longer than the timeout itself', () => {
    expect(getIdlePhase(0, 30)).toEqual({ phase: 'warning', remainingSeconds: 30 })
  })
})

describe('shouldEndSessionOnBoot', () => {
  const now = 1_000_000

  it('does nothing when there is no session to end', () => {
    expect(
      shouldEndSessionOnBoot({ hasSession: false, now, lastAliveAt: null, otherTabsAlive: false }),
    ).toBe(false)
  })

  it('keeps the session when another tab is open (a second tab joins it)', () => {
    expect(
      shouldEndSessionOnBoot({ hasSession: true, now, lastAliveAt: now - 3_600_000, otherTabsAlive: true }),
    ).toBe(false)
  })

  it('keeps the session on a reload (the page was alive a moment ago)', () => {
    expect(
      shouldEndSessionOnBoot({ hasSession: true, now, lastAliveAt: now - 2_000, otherTabsAlive: false }),
    ).toBe(false)
    expect(
      shouldEndSessionOnBoot({
        hasSession: true,
        now,
        lastAliveAt: now - LIVENESS_GRACE_MS,
        otherTabsAlive: false,
      }),
    ).toBe(false)
  })

  it('ends the session when the app was closed and is being opened again', () => {
    expect(
      shouldEndSessionOnBoot({
        hasSession: true,
        now,
        lastAliveAt: now - LIVENESS_GRACE_MS - 1,
        otherTabsAlive: false,
      }),
    ).toBe(true)
  })

  it('ends the session when there is no liveness record at all', () => {
    expect(
      shouldEndSessionOnBoot({ hasSession: true, now, lastAliveAt: null, otherTabsAlive: false }),
    ).toBe(true)
  })
})

describe('logout reason', () => {
  beforeEach(() => localStorage.clear())

  it('is read once and then cleared', () => {
    setLogoutReason('idle')
    expect(consumeLogoutReason()).toBe('idle')
    expect(consumeLogoutReason()).toBeNull()
  })

  it('ignores anything that is not a known reason', () => {
    localStorage.setItem(LOGOUT_REASON_KEY, 'something-else')
    expect(consumeLogoutReason()).toBeNull()
  })
})
