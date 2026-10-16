import { Pipette } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CATEGORY_COLOR_CHOICES } from '@/lib/categoryIcons'

/** The usual swatches + one last "custom" that opens the browser's native
 * color picker (<input type="color">, no libraries) -- the real input
 * stays invisible on top of the circle, so the click opens the OS picker
 * directly, with no dialog of our own to maintain. While the active color
 * isn't any of the fixed swatches, that last dot shows the chosen hex (and
 * the "selected" ring moves there) instead of staying on the inviting
 * gradient. */
export function ColorSwatchPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const { t } = useTranslation('pages')
  const isCustom = !CATEGORY_COLOR_CHOICES.includes(value)

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted-foreground">{t('categories.colorLabel')}</label>
      <div className="flex flex-wrap gap-2">
        {CATEGORY_COLOR_CHOICES.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => onChange(color)}
            className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center"
            style={{
              background: color,
              outline: !isCustom && value === color ? '2px solid var(--nl-text-primary)' : 'none',
              outlineOffset: '2px',
            }}
            aria-label={t('categories.colorSwatchAriaLabel', { color })}
          />
        ))}
        <label
          className="relative w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center cursor-pointer"
          style={{
            background: isCustom
              ? value
              : 'conic-gradient(from 180deg, #f04e4e, #f5a623, #16a34a, #0891b2, #4e8ef0, #6366f1, #c026d3, #f04e4e)',
            outline: isCustom ? '2px solid var(--nl-text-primary)' : 'none',
            outlineOffset: '2px',
          }}
          title={t('categories.customColorTitle')}
        >
          {!isCustom && <Pipette size={12} color="white" style={{ filter: 'drop-shadow(0 0 1px rgb(0 0 0 / 0.6))' }} />}
          <input
            type="color"
            value={isCustom ? value : '#00c9a7'}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label={t('categories.customColorAriaLabel')}
          />
        </label>
      </div>
    </div>
  )
}
