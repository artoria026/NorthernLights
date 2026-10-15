import { useTranslation } from 'react-i18next'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PAGE_SIZE_OPTIONS } from '@/hooks/usePageSize'

/** "Rows per page" picker that sits next to a list's pager. Same Select as every
 * other combo in the app. */
export function PageSizeSelect({ value, onChange }: { value: number; onChange: (size: number) => void }) {
  const { t } = useTranslation('common')
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>{t('pageSize.label')}</span>
      <Select value={String(value)} onValueChange={(v) => v && onChange(Number(v))}>
        <SelectTrigger className="h-8 w-auto min-w-[64px]" aria-label={t('pageSize.label')}>
          <SelectValue>{(v: string) => v}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {PAGE_SIZE_OPTIONS.map((size) => (
            <SelectItem key={size} value={String(size)}>
              {size}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
