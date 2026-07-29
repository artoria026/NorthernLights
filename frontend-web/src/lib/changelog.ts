export interface ChangelogEntry {
  version: string
  date: string
  title: string
  items: string[]
}

/** Orden: mas reciente primero (indice 0). Cada release nueva se agrega
 * arriba con un `version` que ordene despues del anterior (fecha
 * YYYY.MM.DD alcanza, no hace falta semver real) -- ver ChangelogButton.tsx
 * para como se compara contra `user.last_seen_changelog_version`. */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '2026.08.10',
    date: '2026-08-10',
    title: 'Subcategorías, reportes al día y sesiones más claras',
    items: [
      'Las categorías de gasto ahora pueden tener subcategorías propias (ej. "Restaurantes" dentro de "Comida y Bebidas").',
      'Podés desactivar una categoría del sistema solo para vos -- reversible, no afecta a nadie más.',
      'El presupuesto y los reportes agrupan el gasto de las subcategorías dentro de su categoría padre, con el desglose disponible al desplegar.',
      'Pantallas de inicio de sesión y registro rediseñadas, con transición animada entre ambas.',
    ],
  },
]

export const LATEST_CHANGELOG_VERSION = CHANGELOG[0].version
