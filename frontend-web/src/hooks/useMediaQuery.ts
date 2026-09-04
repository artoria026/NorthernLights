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

/** Same `lg` breakpoint already used by the rest of the app (sidebar, layout
 * splits) -- a single source of truth for "we're in desktop view".
 * Using this (instead of just hidden/lg:hidden classes) is mandatory when the
 * row has a Dialog with local state: two CSS-hidden trees would mount the
 * Dialog twice, and opening either of the two triggers would show it
 * duplicated. With this hook only one tree exists in the DOM at a time. */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)')
}
