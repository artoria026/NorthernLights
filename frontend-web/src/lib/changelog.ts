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
 * igualdad, nunca por orden. */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.1',
    date: '2026-08-14',
    title: 'El asesor confirma con botones, y arreglos en Deudas',
    items: [
      'Cuando el asesor va a registrar algo por ti (una cuenta, una deuda, un gasto), ahora te lo confirma con una tarjeta y dos botones -- ya no hace falta escribirle "sí".',
      'El chat del asesor dejó de mover toda la pantalla al hacer scroll -- ahora solo se desplaza la conversación, el resumen de al lado se queda quieto.',
      'Más colores en el resumen financiero del asesor, para distinguir de un vistazo tu patrimonio, tu salud financiera y tus movimientos recientes.',
      'Si le pides al asesor que revise un estado de cuenta muy largo y su respuesta se corta, ahora te avisa en vez de dejarla a medias sin decir nada.',
      'Adjuntar estados de cuenta en PDF, cargar un Excel o traer datos desde otra IA ahora vive todo dentro de Asesor IA, ya no es una pantalla aparte.',
      'Si registrabas una tarjeta de crédito sin elegir su cuenta correspondiente, ahora te lo pedimos al crearla -- y si ya tenías una así, "Registrar pago" te deja corregirlo ahí mismo.',
      'El aviso de "Novedades" ya no te salía duplicado, y ahora muestra con claridad la versión y la fecha de cada liberación.',
      'El botón de "Continuar con Google" se deshabilitó por ahora, mientras terminamos de configurarlo correctamente -- vas a poder usarlo en cuanto esté listo.',
      'Cerrar sesión ahora te pide confirmación antes de salir, para evitar que sea un clic accidental.',
    ],
  },
  {
    version: '0.2.0',
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

/** Cuantas releases se muestran en el modal de Novedades -- CHANGELOG entero
 * queda como el historico real (crece para siempre), pero mostrarlo completo
 * cada vez que alguien abre el modal no tiene sentido pasadas unas pocas
 * releases. Subir este numero no cambia nada mas (LATEST_CHANGELOG_VERSION
 * sigue siendo CHANGELOG[0], el auto-open sigue comparando contra esa). */
export const RECENT_CHANGELOG_COUNT = 3

export function getRecentChangelog(): ChangelogEntry[] {
  return CHANGELOG.slice(0, RECENT_CHANGELOG_COUNT)
}
