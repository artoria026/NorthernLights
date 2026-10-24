import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Check, ChevronDown, Search, type LucideIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  SUBSCRIPTION_ICONS,
  type IconDef,
  iconLabel,
  matchesIcon,
  resolveIcon,
} from '@/lib/subscriptionIcons'

function Glyph({ def, size }: { def: IconDef; size: number }) {
  if (def.brand) return <FontAwesomeIcon icon={def.brand} style={{ width: size, height: size }} />
  const Generic = def.generic!
  return <Generic size={size} strokeWidth={1.7} />
}

/** The icon of a subscription or recurring item in a small tile: the one it was given, else the
 * one its name suggests, else the first letter of the name (what the tile used to always be). */
export function SubscriptionIcon({
  icon,
  name,
  size = 'md',
  fallback: Fallback,
}: {
  icon?: string | null
  name: string
  size?: 'sm' | 'md'
  /** Drawn instead of the first letter when nothing fits (e.g. the icon of the item's type). */
  fallback?: LucideIcon
}) {
  const def = resolveIcon(icon, name)
  const box = size === 'sm' ? 'w-6 h-6' : 'w-7 h-7'
  const glyph = size === 'sm' ? 13 : 15
  return (
    <div
      className={`${box} rounded-md flex items-center justify-center text-[11px] font-medium flex-shrink-0`}
      style={{ background: 'var(--nl-bg-track)' }}
      aria-hidden
    >
      {def ? (
        <Glyph def={def} size={glyph} />
      ) : Fallback ? (
        <Fallback size={glyph} strokeWidth={1.7} />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </div>
  )
}

/** Field of the create/edit forms. `value` null means "automatic": the icon follows the name as
 * it is typed, and the field says which one that is. */
export function SubscriptionIconPicker({
  value,
  name,
  onChange,
}: {
  value: string | null
  name: string
  onChange: (icon: string | null) => void
}) {
  const { t } = useTranslation('pages')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const current = resolveIcon(value, name)
  const options = useMemo(() => SUBSCRIPTION_ICONS.filter((def) => matchesIcon(def, query)), [query])

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted-foreground">{t('subscriptionIcons.label')}</label>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex h-9 w-full items-center gap-2.5 rounded-md border border-border px-2.5 text-left text-[13px]"
        style={{ background: 'var(--nl-bg-input)' }}
      >
        <SubscriptionIcon icon={value} name={name} size="sm" />
        <span className="flex-1 truncate">
          {value && current
            ? iconLabel(current)
            : current
              ? t('subscriptionIcons.automaticWith', { name: iconLabel(current) })
              : t('subscriptionIcons.automatic')}
        </span>
        <ChevronDown size={14} className={`text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="rounded-md border border-border p-2.5" style={{ background: 'var(--nl-bg-input)' }}>
          <div className="relative mb-2">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('subscriptionIcons.search')}
              className="h-8 w-full rounded-md border border-border bg-transparent pl-8 pr-2 text-[13px]"
            />
          </div>
          <div className="max-h-44 overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                onChange(null)
                setOpen(false)
              }}
              className="mb-1.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-[var(--nl-bg-track)]"
            >
              {value === null ? <Check size={13} /> : <span className="w-[13px]" />}
              {t('subscriptionIcons.automatic')}
            </button>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1">
              {options.map((def) => (
                <button
                  key={def.key}
                  type="button"
                  title={iconLabel(def)}
                  aria-label={iconLabel(def)}
                  aria-pressed={value === def.key}
                  onClick={() => {
                    onChange(def.key)
                    setOpen(false)
                  }}
                  className={`flex h-10 items-center justify-center rounded-md border hover:bg-[var(--nl-bg-track)] ${
                    value === def.key ? 'border-[var(--nl-accent)]' : 'border-transparent'
                  }`}
                >
                  <Glyph def={def} size={17} />
                </button>
              ))}
            </div>
            {options.length === 0 && (
              <p className="py-3 text-center text-xs text-muted-foreground">{t('subscriptionIcons.empty')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
