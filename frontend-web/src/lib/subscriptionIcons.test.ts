import { describe, expect, it } from 'vitest'
import { isKnownIcon, resolveIcon, suggestIcon } from './subscriptionIcons'

describe('suggestIcon', () => {
  it.each([
    ['Spotify familiar', 'spotify'],
    ['Google One', 'google'],
    ['Regalo - Google One de Jose Manuel', 'google'],
    ['Amazon Prime', 'amazon'],
    ['LinkedIn Premium', 'linkedin'],
    ['Servidor - Hetzner', 'server'],
    ['Claude', 'ai'],
    ['Seguro Santander - Blindaje total', 'insurance'],
    ['Meli+', 'shopping'],
    ['Netflix', 'streaming'],
  ])('%s -> %s', (name, expected) => {
    expect(suggestIcon(name)).toBe(expected)
  })

  it('matches whole words only: "gas" is a utility, "gasolina" is not', () => {
    expect(suggestIcon('Gas natural')).toBe('gas')
    expect(suggestIcon('Gasolina')).toBe('car')
  })

  it('ignores accents and case', () => {
    expect(suggestIcon('MÚSICA en línea')).toBe('music')
  })

  it('gives a brand priority over a generic icon', () => {
    expect(suggestIcon('Seguro de Amazon')).toBe('amazon')
  })

  it('suggests nothing for an unknown or empty name', () => {
    expect(suggestIcon('Cosa rara')).toBeNull()
    expect(suggestIcon('   ')).toBeNull()
  })
})

describe('resolveIcon', () => {
  it('prefers the icon the user picked over the suggestion', () => {
    expect(resolveIcon('server', 'Spotify')?.key).toBe('server')
  })

  it('falls back to the suggestion when there is none, or the key no longer exists', () => {
    expect(resolveIcon(null, 'Spotify')?.key).toBe('spotify')
    expect(resolveIcon('borrado', 'Spotify')?.key).toBe('spotify')
    expect(resolveIcon(null, 'Cosa rara')).toBeNull()
  })

  it('knows which keys exist', () => {
    expect(isKnownIcon('spotify')).toBe(true)
    expect(isKnownIcon('nope')).toBe(false)
    expect(isKnownIcon(null)).toBe(false)
  })
})
