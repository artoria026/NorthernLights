/** Pure rules + browser plumbing for the bank-style session timeout:
 *
 *  - Inactivity: 10 min by default (the server sends the real limit, see
 *    TokenPair.idle_timeout_seconds) with a 60 s "still there?" countdown
 *    before the session is closed.
 *  - App restart: closing the browser/tab/PWA and opening it again asks for the
 *    login again. A reload (F5) or opening a second tab keeps the session.
 *
 * Everything is timestamp-based (never a counter that ticks down), so
 * background tabs with throttled timers and a suspended laptop still end up with
 * the right answer. */

export const DEFAULT_IDLE_TIMEOUT_SECONDS = 600
export const WARNING_SECONDS = 60

/** Real user input is reported to the server at most this often. */
export const ACTIVITY_PING_INTERVAL_MS = 60_000
/** ...and written to localStorage (to sync other tabs) at most this often. */
export const ACTIVITY_WRITE_THROTTLE_MS = 2_000

/** How recently a page must have been alive for a fresh load to count as a reload. */
export const LIVENESS_GRACE_MS = 15_000
export const LIVENESS_BEAT_MS = 10_000

export const LAST_ACTIVITY_KEY = 'nl-last-activity'
export const LAST_ALIVE_KEY = 'nl-last-alive'
export const LOGOUT_REASON_KEY = 'nl-logout-reason'
const ALIVE_LOCK_NAME = 'nl-session-alive'

export type LogoutReason = 'idle' | 'restart'

export type IdlePhase =
  | { phase: 'active' }
  | { phase: 'warning'; remainingSeconds: number }
  | { phase: 'expired' }

/** Where the inactivity countdown stands, given how long the person has been idle. */
export function getIdlePhase(idleMs: number, timeoutSeconds: number): IdlePhase {
  const timeoutMs = timeoutSeconds * 1000
  if (idleMs >= timeoutMs) return { phase: 'expired' }
  const warningMs = Math.max(timeoutMs - WARNING_SECONDS * 1000, 0)
  if (idleMs >= warningMs) {
    return { phase: 'warning', remainingSeconds: Math.ceil((timeoutMs - idleMs) / 1000) }
  }
  return { phase: 'active' }
}

/** On app start: keep the saved session or end it? Kept only if no session is
 * saved anyway (nothing to end), another tab of the app is alive (a second tab
 * joins the session), or this page was alive a moment ago (a reload). Anything
 * else means the app was closed and is being opened again. */
export function shouldEndSessionOnBoot(input: {
  hasSession: boolean
  now: number
  lastAliveAt: number | null
  otherTabsAlive: boolean
}): boolean {
  if (!input.hasSession) return false
  if (input.otherTabsAlive) return false
  if (input.lastAliveAt !== null && input.now - input.lastAliveAt <= LIVENESS_GRACE_MS) return false
  return true
}

// -- localStorage helpers (can throw or be unavailable: private mode, blocked data) --

function readNumber(key: string): number | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function writeNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // Without storage the session just can't sync across tabs / survive a reload check.
  }
}

export const readLastActivity = (): number | null => readNumber(LAST_ACTIVITY_KEY)
export const writeLastActivity = (at: number): void => writeNumber(LAST_ACTIVITY_KEY, at)
export const readLastAlive = (): number | null => readNumber(LAST_ALIVE_KEY)

export function setLogoutReason(reason: LogoutReason): void {
  try {
    localStorage.setItem(LOGOUT_REASON_KEY, reason)
  } catch {
    // Not being able to explain why is better than blocking the logout.
  }
}

/** Reads and clears why the last session ended, for the login screen. */
export function consumeLogoutReason(): LogoutReason | null {
  try {
    const reason = localStorage.getItem(LOGOUT_REASON_KEY)
    localStorage.removeItem(LOGOUT_REASON_KEY)
    return reason === 'idle' || reason === 'restart' ? reason : null
  } catch {
    return null
  }
}

// -- liveness: is the app open somewhere? --

/** Is another tab/window of the app open right now? A shared Web Lock is held by
 * every live tab for its whole life and released by the browser the moment it
 * closes or crashes -- no timers involved, so a hidden tab whose timers the
 * browser throttles still counts. Browsers without Web Locks answer false and
 * fall back to the timestamp check. */
export async function otherTabsAlive(): Promise<boolean> {
  try {
    if (!('locks' in navigator)) return false
    const state = await navigator.locks.query()
    return (state.held ?? []).some((lock) => lock.name === ALIVE_LOCK_NAME)
  } catch {
    return false
  }
}

/** Marks this page alive: holds the lock and keeps a last-seen timestamp fresh
 * (also written on the way out, which is what lets a reload through). */
export function startLiveness(): void {
  const beat = () => writeNumber(LAST_ALIVE_KEY, Date.now())
  beat()
  window.setInterval(beat, LIVENESS_BEAT_MS)
  window.addEventListener('pagehide', beat)
  document.addEventListener('visibilitychange', beat)

  try {
    if ('locks' in navigator) {
      // Never resolves: held until the page goes away.
      void navigator.locks.request(ALIVE_LOCK_NAME, { mode: 'shared' }, () => new Promise<void>(() => {}))
    }
  } catch {
    // Timestamp fallback only.
  }
}

// -- activity reported by code (not by the user's hands) --

export const ACTIVITY_EVENT = 'nl:activity'

/** For work the person is plainly waiting on without touching anything (an AI
 * answer streaming in): counts as activity so the countdown doesn't interrupt it. */
export function reportActivity(): void {
  window.dispatchEvent(new Event(ACTIVITY_EVENT))
}
