import { Target } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { HEADER_SECTIONS, ViewHeader } from '@/components/nl/primitives'

export function Goals() {
  const { t } = useTranslation('pages')
  return (
    <div>
      <ViewHeader icon={<Target />} title={t('goals.title')} section={HEADER_SECTIONS.diario} />
      <div className="bg-card border border-dashed border-border rounded-md p-10 text-center flex flex-col items-center gap-3">
        <Target size={32} className="text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground max-w-md">{t('goals.comingSoon')}</p>
      </div>
    </div>
  )
}
