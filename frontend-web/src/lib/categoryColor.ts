const CATEGORY_TOKENS = [
  'var(--nl-warning-ink)',
  'var(--nl-blue-ink)',
  'var(--nl-violet-ink)',
  'var(--nl-pink)',
  'var(--nl-danger-ink)',
  'var(--nl-accent-ink)',
] as const

/** Deterministic text color by category name (simple hash, no fixed list of
 * names -- works the same for system categories and ones the user creates).
 * Same name always gives the same color. */
export function categoryColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return CATEGORY_TOKENS[Math.abs(hash) % CATEGORY_TOKENS.length]
}
