import { useEffect, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const handler = () => setMatches(mql.matches)
    handler()
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [query])

  return matches
}

/** Mismo breakpoint `lg` que ya usa el resto de la app (sidebar, splits de
 * layout) -- una sola fuente de verdad para "estamos en vista de escritorio".
 * Usar esto (en vez de solo clases hidden/lg:hidden) es obligatorio cuando la
 * fila tiene un Dialog con estado local: dos arboles CSS-ocultos montarian el
 * Dialog dos veces, y al abrir cualquiera de los dos triggers apareceria por
 * duplicado. Con este hook solo un arbol existe en el DOM a la vez. */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)')
}
