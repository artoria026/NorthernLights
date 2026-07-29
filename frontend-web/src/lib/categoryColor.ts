const CATEGORY_TOKENS = [
  'var(--nl-warning-ink)',
  'var(--nl-blue-ink)',
  'var(--nl-violet-ink)',
  'var(--nl-pink)',
  'var(--nl-danger-ink)',
  'var(--nl-accent-ink)',
] as const

/** Color de texto determinístico por nombre de categoría (hash simple, sin
 * lista fija de nombres -- funciona igual para las categorías del sistema y
 * para las que el usuario cree). Mismo nombre siempre da el mismo color. */
export function categoryColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return CATEGORY_TOKENS[Math.abs(hash) % CATEGORY_TOKENS.length]
}
