import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useTags } from '@/hooks/useTags'
import { formatMoney } from '@/lib/utils'

const SHOWN = 4

/** Dashboard card: the most recently used tags and what each has spent. Hidden
 * until the user has created at least one tag. */
export function TagsOverviewCard() {
  const { t } = useTranslation('pages')
  const { data: tags = [] } = useTags()
  const active = tags.filter((tag) => tag.transaction_count > 0).slice(0, SHOWN)
  if (active.length === 0) return null

  return (
    <div className="lg:col-span-2 bg-card border border-border rounded-md p-4" data-tour="dashboard:tags">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[15px] font-medium">{t('dashboard.tags.heading')}</span>
        <Link to="/tags" className="text-xs text-muted-foreground hover:text-foreground">
          {t('dashboard.tags.viewAll')}
        </Link>
      </div>
      <ul className="flex flex-col gap-2.5">
        {active.map((tag) => (
          <li key={tag.id}>
            <Link to={`/transactions?tag=${tag.id}`} className="flex items-center gap-3 text-[13px] hover:opacity-80">
              <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: tag.color }} />
              <span className="min-w-0 flex-1 truncate">{tag.name}</span>
              <span className="flex-shrink-0 text-[11.5px] text-muted-foreground">
                {t('tags.listCount', { count: tag.transaction_count })}
              </span>
              <span className="flex-shrink-0">{formatMoney(tag.total_spent)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
