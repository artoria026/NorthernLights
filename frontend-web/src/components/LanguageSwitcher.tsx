import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { SegmentedControl } from '@/components/nl/primitives'
import { useSyncedLocale } from '@/hooks/useAuth'
import { SUPPORTED_LANGUAGES } from '@/lib/i18n'
import type { Locale } from '@/types'

// Inline SVGs instead of flag emoji -- flag emoji rendering is unreliable
// across platforms (some systems show the two-letter code instead of the
// actual flag, or nothing at all if the font lacks the glyph). An SVG
// renders identically everywhere. Simplified (no coat of arms/stars): at
// 16px these details would be illegible noise, not something recognizable.
function FlagMX() {
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true" className="rounded-[1.5px] flex-shrink-0">
      <rect width="16" height="12" fill="#fff" />
      <rect width="5.33" height="12" fill="#006341" />
      <rect x="10.67" width="5.33" height="12" fill="#ce1126" />
    </svg>
  )
}

function FlagUS() {
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true" className="rounded-[1.5px] flex-shrink-0">
      <rect width="16" height="12" fill="#fff" />
      {[0, 2, 4, 6, 8, 10].map((y) => (
        <rect key={y} y={y} width="16" height="1" fill="#b22234" />
      ))}
      <rect width="7" height="6.5" fill="#3c3b6e" />
    </svg>
  )
}

const LANGUAGE_FLAG: Record<Locale, () => ReactElement> = {
  es: FlagMX,
  en: FlagUS,
}

const LANGUAGE_CODE: Record<Locale, string> = {
  es: 'ES',
  en: 'EN',
}

function languageLabel(t: (key: string) => string, lang: Locale): string {
  return t(`languageSwitcher.options.${lang}`)
}

/** Reusable ES/EN control -- used today in Settings (persists to the
 * account via useSyncedLocale/PUT auth/settings) and on AuthLayout
 * (Login/Register), before there's a session (useSyncedLocale still
 * updates i18next + its localStorage cache with no session; the PUT just
 * silently fails without a token, which is fine there since there's
 * nothing to persist yet). A flag+code segmented pill instead of a
 * dropdown -- there are only ever two options, so a full Select was more
 * chrome than the choice warranted. */
export function LanguageSwitcher() {
  const { t } = useTranslation('common')
  const { locale, setLocale, isPending } = useSyncedLocale()

  return (
    <SegmentedControl
      value={locale}
      onChange={(next) => {
        if (!isPending) setLocale(next)
      }}
      className={isPending ? 'opacity-60' : undefined}
      aria-label={t('languageSwitcher.ariaLabel')}
      options={SUPPORTED_LANGUAGES.map((lang) => {
        const Flag = LANGUAGE_FLAG[lang]
        return {
          value: lang,
          label: (
            <span className="inline-flex items-center gap-1.5">
              <Flag />
              {LANGUAGE_CODE[lang]}
            </span>
          ),
          title: languageLabel(t, lang),
        }
      })}
    />
  )
}
