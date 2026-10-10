import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ACTIVITY_EVENT,
  ACTIVITY_PING_INTERVAL_MS,
  ACTIVITY_WRITE_THROTTLE_MS,
  DEFAULT_IDLE_TIMEOUT_SECONDS,
  LAST_ACTIVITY_KEY,
  type LogoutReason,
  getIdlePhase,
  readLastActivity,
  setLogoutReason,
  writeLastActivity,
} from '@/lib/sessionTimeout'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import type { ApiSuccess } from '@/types'

const USER_INPUT_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel'] as const

/** Bank-style inactivity timeout for the signed-in area.
 *
 * Tracks real user input (never API traffic: a background poll must not keep
 * an abandoned session alive), tells the server about it so its own limit
 * (the one that actually can't be bypassed) stays in step, and, shortly before
 * the limit, asks "still there?" with a countdown. Without an answer it signs
 * out. Several tabs share one clock through localStorage. */
export function useSessionTimeout() {
  const queryClient = useQueryClient()
  const idleTimeoutSeconds = useAuthStore((s) => s.idleTimeoutSeconds) ?? DEFAULT_IDLE_TIMEOUT_SECONDS
  const timeoutRef = useRef(idleTimeoutSeconds)
  timeoutRef.current = idleTimeoutSeconds

  const lastActivityRef = useRef<number>(readLastActivity() ?? Date.now())
  const lastWriteRef = useRef(0)
  const lastPingRef = useRef(0)
  const endingRef = useRef(false)
  const warningRef = useRef(false)
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null)

  const endSession = useCallback(
    async (reason: LogoutReason) => {
      if (endingRef.current) return
      endingRef.current = true
      setLogoutReason(reason)
      const { refreshToken, logout } = useAuthStore.getState()
      // Revoke on the server first (it needs the access token we're about to drop);
      // best effort, the local sign-out happens regardless.
      if (refreshToken) {
        await api.post('/auth/logout', { refresh_token: refreshToken }).catch(() => null)
      }
      logout()
      queryClient.clear()
    },
    [queryClient],
  )

  const pingServer = useCallback((force = false) => {
    const { refreshToken, setIdleTimeoutSeconds } = useAuthStore.getState()
    const now = Date.now()
    if (!refreshToken || (!force && now - lastPingRef.current < ACTIVITY_PING_INTERVAL_MS)) return
    lastPingRef.current = now
    api
      .post<ApiSuccess<{ idle_timeout_seconds: number }>>('/auth/activity', {
        refresh_token: refreshToken,
      })
      .then((res) => setIdleTimeoutSeconds(res.data.data.idle_timeout_seconds))
      // A rejected ping (expired session, network) is handled where it matters:
      // the next refresh, or the local countdown.
      .catch(() => null)
  }, [])

  const touch = useCallback(
    (force = false) => {
      const now = Date.now()
      lastActivityRef.current = now
      if (force || now - lastWriteRef.current >= ACTIVITY_WRITE_THROTTLE_MS) {
        lastWriteRef.current = now
        writeLastActivity(now)
      }
      pingServer(force)
    },
    [pingServer],
  )

  /** "Keep me signed in" from the countdown: the only thing that counts as
   * activity while the warning is up (stray mouse movement shouldn't dismiss it). */
  const stayConnected = useCallback(() => {
    warningRef.current = false
    setRemainingSeconds(null)
    touch(true)
  }, [touch])

  const signOutNow = useCallback(() => void endSession('idle'), [endSession])

  useEffect(() => {
    // First ping on mount: syncs the server's limit (the Google sign-in path
    // doesn't carry it) and counts the page load itself as presence.
    touch(true)

    const onActivity = () => {
      if (!warningRef.current) touch()
    }
    for (const type of USER_INPUT_EVENTS) {
      window.addEventListener(type, onActivity, { passive: true, capture: true })
    }
    window.addEventListener(ACTIVITY_EVENT, onActivity)

    // Another tab's activity (or its "keep me signed in") resets this one's clock.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== LAST_ACTIVITY_KEY) return
      const at = readLastActivity()
      if (at !== null && at > lastActivityRef.current) {
        lastActivityRef.current = at
        evaluate()
      }
    }
    window.addEventListener('storage', onStorage)

    function evaluate() {
      const result = getIdlePhase(Date.now() - lastActivityRef.current, timeoutRef.current)
      if (result.phase === 'expired') {
        void endSession('idle')
      } else if (result.phase === 'warning') {
        warningRef.current = true
        setRemainingSeconds(result.remainingSeconds)
      } else if (warningRef.current) {
        warningRef.current = false
        setRemainingSeconds(null)
      }
    }

    const timer = window.setInterval(evaluate, 1000)
    // Waking up a suspended laptop / returning to a long-hidden tab: decide now,
    // not on the next tick.
    document.addEventListener('visibilitychange', evaluate)

    return () => {
      for (const type of USER_INPUT_EVENTS) {
        window.removeEventListener(type, onActivity, { capture: true })
      }
      window.removeEventListener(ACTIVITY_EVENT, onActivity)
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', evaluate)
      window.clearInterval(timer)
    }
  }, [touch, endSession])

  return { remainingSeconds, stayConnected, signOutNow }
}
