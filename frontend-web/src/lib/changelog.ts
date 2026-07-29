export interface ChangelogEntry {
  version: string
  date: string
  title: string
  items: string[]
}

/** Orden: mas reciente primero (indice 0). Cada release nueva se agrega
 * arriba con el `version` real de ese momento (el mismo numero que
 * frontend-web/package.json, el que se ve como "NorthernLights vX.X.X" al
 * pie del sidebar) y su `date` de liberacion -- ambos se muestran juntos y
 * por separado en el modal (ver ChangelogButton.tsx), no hace falta que el
 * version "ordene" nada por si solo: `LATEST_CHANGELOG_VERSION` es siempre
 * CHANGELOG[0], y `user.last_seen_changelog_version` solo se compara por
 * igualdad, nunca por orden.
 *
 * Vacio a proposito en v1.0.0 -- las entradas anteriores documentaban
 * releases para usuarios de prueba (0.2.0, 1.0.1), que no tiene sentido
 * mostrar como "novedades" en el primer release publico real: implicarian
 * versiones publicas previas que nadie afuera vio. A partir de aqui, cada
 * release publica nueva agrega su entrada arriba. */
export const CHANGELOG: ChangelogEntry[] = []

/** null cuando CHANGELOG esta vacio (ver arriba) -- ChangelogButton/Dialog
 * tratan null como "nada que mostrar", nunca marcan version como no-vista. */
export const LATEST_CHANGELOG_VERSION: string | null = CHANGELOG[0]?.version ?? null

/** Cuantas releases se muestran en el modal de Novedades -- CHANGELOG entero
 * queda como el historico real (crece para siempre), pero mostrarlo completo
 * cada vez que alguien abre el modal no tiene sentido pasadas unas pocas
 * releases. Subir este numero no cambia nada mas (LATEST_CHANGELOG_VERSION
 * sigue siendo CHANGELOG[0], el auto-open sigue comparando contra esa). */
export const RECENT_CHANGELOG_COUNT = 3

export function getRecentChangelog(): ChangelogEntry[] {
  return CHANGELOG.slice(0, RECENT_CHANGELOG_COUNT)
}
