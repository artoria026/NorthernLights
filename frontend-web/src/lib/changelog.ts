export interface ChangelogEntry {
  version: string
  date: string
  title: string
  items: string[]
}

/** Order: most recent first (index 0). Each new release is added at the top
 * with the real `version` at that time (the same number as
 * frontend-web/package.json, the one shown as "NorthernLights vX.X.X" at
 * the bottom of the sidebar) and its release `date` -- both are shown
 * together and separately in the modal (see ChangelogButton.tsx); the
 * version doesn't need to "sort" anything by itself:
 * `LATEST_CHANGELOG_VERSION` is always CHANGELOG[0], and
 * `user.last_seen_changelog_version` is only compared by equality, never by
 * order.
 *
 * Empty on purpose in v1.0.0 -- previous entries documented releases for
 * test users (0.2.0, 1.0.1), which doesn't make sense to show as "what's
 * new" in the first real public release: they'd imply prior public versions
 * that nobody outside ever saw. From here on, each new public release adds
 * its entry at the top. */
export const CHANGELOG: ChangelogEntry[] = []

/** null when CHANGELOG is empty (see above) -- ChangelogButton/Dialog treat
 * null as "nothing to show", never mark a version as unseen. */
export const LATEST_CHANGELOG_VERSION: string | null = CHANGELOG[0]?.version ?? null

/** How many releases are shown in the What's New modal -- the full
 * CHANGELOG remains the real history (grows forever), but showing it in
 * full every time someone opens the modal doesn't make sense past a few
 * releases. Raising this number doesn't change anything else
 * (LATEST_CHANGELOG_VERSION is still CHANGELOG[0], auto-open still compares
 * against that). */
export const RECENT_CHANGELOG_COUNT = 3

export function getRecentChangelog(): ChangelogEntry[] {
  return CHANGELOG.slice(0, RECENT_CHANGELOG_COUNT)
}
