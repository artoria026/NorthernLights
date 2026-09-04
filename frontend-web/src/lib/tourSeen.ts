import type { ModuleKey } from '@/lib/tours'

/** Whether this module's welcome modal has already been shown to this user
 * in this browser -- localStorage on purpose (same criteria as
 * getRecentCategoryIcons in categoryIcons.ts: it's a purely UX preference,
 * not worth a backend table/endpoint). The persistent "Tour" button in the
 * header keeps working regardless of this flag. */
const seenKey = (moduleKey: ModuleKey) => `nl:tour-seen:${moduleKey}`

export function hasSeenTourWelcome(moduleKey: ModuleKey): boolean {
  try {
    return localStorage.getItem(seenKey(moduleKey)) === '1'
  } catch {
    return false
  }
}

export function markTourWelcomeSeen(moduleKey: ModuleKey): void {
  try {
    localStorage.setItem(seenKey(moduleKey), '1')
  } catch {
    // localStorage not available (private mode, etc.) -- not critical, ignored
  }
}
