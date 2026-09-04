# How to release a version and write its changelog

This guide is for when a release of NorthernLights is about to go out: which version number
it gets, how to pull the list of changes reliably (not from memory), and how to write each
line of the changelog end users see inside the app ("What's new", the 📣 icon in the
sidebar).

This isn't a guide on how to build the feature — it's the checklist for the **closing**
steps of a release, once the code is already done.

## 1. Where all of this lives

- **App version:** `frontend-web/package.json`, the `"version"` field. This is what shows up
  as "NorthernLights vX.X.X" at the bottom of the sidebar (`AppSidebar.tsx`). A single version
  covers frontend and backend together — they aren't versioned separately, since they're
  released together.
- **Changelog:** `frontend-web/src/lib/changelog.ts`, the `CHANGELOG` array. Each entry:
  ```ts
  {
    version: '1.0.1',       // MUST match package.json's version for that release
    date: '2026-08-14',     // actual release date, YYYY-MM-DD format
    title: 'Short release title',
    items: ['Change 1 in plain language...', 'Change 2...'],
  }
  ```
- **How it's shown:** `ChangelogButton.tsx` → `ChangelogDialog`. It auto-opens once per user
  when `user.last_seen_changelog_version` (stored on their account) doesn't match
  `LATEST_CHANGELOG_VERSION` (which is always `CHANGELOG[0].version`, the newest entry). The
  comparison is **exact string equality**, not ordering — so each entry's `version` value has
  to be unique and never reused.
- **How many are shown:** the modal only renders the last `RECENT_CHANGELOG_COUNT` entries
  (`getRecentChangelog()`), currently 3. The full `CHANGELOG` stays as the real history and
  keeps growing — there's no need to delete old entries, just let them fall out of the cutoff.

## 2. Pull the real changes, not from memory

**Before writing a single line of the changelog, run a diff against the last release** —
never write it from what you "remember" happened in the conversation/session, since that
forgets things or mixes in work that hasn't shipped yet.

```bash
# If the last release's commit is tagged (see step 5), the cleanest way:
git log v1.0.0..HEAD --oneline
git diff v1.0.0..HEAD --stat

# If there are no tags yet (new project, or you forgot to tag last time),
# the equivalent is diffing against that release's commit by hand:
git log --oneline                      # find the previous release's commit
git diff <that_release_hash>..HEAD --stat
git log <that_release_hash>..HEAD --oneline
```

With that list of commits/files touched:

1. Group by what the user **perceives**, not by file or commit — a single UX change might
   touch 5 files (backend + frontend + tests) and be a single changelog line.
2. Drop anything not visible to the end user (see the "what does NOT go in" list below).
3. For everything that stays, write a line following the writing rules (section 3).

If there's truly no tag or reference for the previous release, the emergency comparison is
against the most recent `CHANGELOG` entry by date (`git log --since=<that date>`), but it's
less precise than an exact tag/commit — avoid it if you can.

## 3. Writing rules (the language)

The changelog is read by someone with no technical context. Every line has to stand on its
own.

**Do:**
- Neutral Spanish, using **tú** address (not "vos", even if some old entries used it — don't
  perpetuate that).
- Talk about the benefit or the new behavior, not the implementation: "it now warns you
  if..." instead of "added a finish_reason check".
- One short sentence per bullet. If more context is needed, an em dash `--` can add one extra
  detail, but not paragraphs.
- Name the screen or action the way the user sees it ("the Log Payment modal", "AI Advisor"),
  not the file/component name.
- For a visible bugfix, it's fine to name the symptom that will no longer happen ("no longer
  gets stuck when...") instead of explaining the technical cause.

**Don't:**
- File names, functions, variables, AI tools, endpoints, database tables.
- Jargon (`linked_account_id`, `tool_calls`, `HTTPException`, `SSE`, `RLS`, `refactor`, `hook`).
- Purely internal changes: new tests, refactors with no behavior change, minor
  spacing/compaction tweaks, dependency bumps, code comments.
- Mixing two changes into one line with "and also" — two short lines are better.

**Real examples (from entries already written):**

| Bad (don't write it like this) | Good (how it was actually written) |
|---|---|
| "Se agregó la tool propose_action que no ejecuta writes" | "Cuando el asesor va a registrar algo por ti, ahora te lo confirma con una tarjeta y dos botones -- ya no hace falta escribirle 'sí'." |
| "Se corrigió el layout flex del chat (min-height/overflow)" | "El chat del asesor dejó de mover toda la pantalla al hacer scroll." |
| "create_debt ahora valida linked_account_id para type=credit_card" | "Si registrabas una tarjeta de crédito sin elegir su cuenta correspondiente, ahora te lo pedimos al crearla." |

### What DOES go in the changelog

- New features the user can use.
- Visible behavior changes (even subtle ones, like a different color or message).
- Fixed bugs the user could notice (something that failed, looked wrong, or blocked them).
- Screens added, removed, or moved.

### What does NOT go in

- Minor visual tweaks (padding, font sizes) unless it's a notable redesign of the whole
  screen.
- Tests, linting, tooling, CI, dependencies.
- Internal refactors with no observable behavior change.
- Config/infra changes that don't affect what the user sees or can do.

When in doubt about whether something is visible enough: if the user would have no way to
notice the difference using the app normally, it doesn't go in.

## 4. The entry title

A short phrase (5-10 words) summarizing the release's main theme, not a list. If there are
two big themes, separate them with a comma: `"The advisor confirms with buttons, and fixes in
Debts"`.

## 5. Which version to give it

`frontend-web/package.json` loosely follows semver (there's no public API with a contract to
break, so the criterion is mostly "how big does this change feel to someone using the app"):

- **Patch (`1.0.1` → `1.0.2`):** bugfixes, small tweaks, a minor feature.
- **Minor (`1.0.x` → `1.1.0`):** a real-sized new feature (a new screen, a new flow), or
  several accumulated patch changes that together feel like a release with real content.
- **Major (`x.0.0`):** a big redesign or a fundamental change in how something central to the
  app works. Infrequent.

Concrete steps:

1. Decide the bump (above) and update `"version"` in `frontend-web/package.json`.
2. Use that SAME number as the `version` of the new entry in `CHANGELOG` (see the format in
   section 1) -- never a different value, and never a date disguised as a version.
3. `date` is the actual date the release goes out (not the date the code was written).
4. The new entry goes at the **start** of the `CHANGELOG` array (index 0) -- so it
   automatically becomes `LATEST_CHANGELOG_VERSION`.

## 6. Tag the release commit

So the next release can diff cleanly (see section 2), tag the commit where the version and
changelog are bumped:

```bash
git tag v1.0.1
git push --tags   # if applicable
```

If this wasn't done for past releases, it's not a big deal -- you just have to find the
commit by hand with `git log` next time. But from here on, tagging every release makes the
process mechanical instead of relying on memory.

## 7. Quick checklist

1. `git log`/`git diff` against the tag or commit of the last release -- never from memory.
2. Group by user-perceived change, drop internal-only ones (section 3).
3. Write each line in plain Spanish, using tú, no jargon, one change per line.
4. Decide the version bump (patch/minor/major) and update it in `frontend-web/package.json`.
5. Add the new entry at the start of `CHANGELOG` in `frontend-web/src/lib/changelog.ts`, with
   the same `version`, the actual date, a short title, and items.
6. Run `tsc --noEmit` (the array is TS, a typo in the object shape gets caught there).
7. Tag the commit (`git tag vX.X.X`).
