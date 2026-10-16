import { Link } from 'react-router-dom'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StatCard } from '@/components/nl/primitives'
import { useTagSummary } from '@/hooks/useTags'
import { SimpleBars } from '@/lib/charts'
import { formatMoney, selectClass } from '@/lib/utils'

/** What a tag has cost: totals, a breakdown by category and by day, over all its
 * expenses or just a date range. Used by the Tags screen and by Reports. */
export function TagSummaryPanel({ tagId }: { tagId: string }) {
  const { t } = useTranslation('pages')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const { data: summary, isLoading, isError } = useTagSummary(tagId, { date_from: from, date_to: to })

  const total = Number(summary?.total_spent ?? 0)
  const period =
    summary?.first_date && summary.last_date
      ? summary.first_date === summary.last_date
        ? summary.first_date
        : `${summary.first_date} → ${summary.last_date}`
      : '—'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{t('tags.summary.period')}</span>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label={t('tags.summary.from')}
          className={`${selectClass} h-8`}
        />
        <span>→</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label={t('tags.summary.to')}
          className={`${selectClass} h-8`}
        />
        {(from || to) && (
          <button
            type="button"
            onClick={() => {
              setFrom('')
              setTo('')
            }}
            className="hover:text-foreground"
          >
            {t('tags.summary.clearPeriod')}
          </button>
        )}
        <Link
          to={`/transactions?tag=${tagId}`}
          className="ml-auto text-[color:var(--nl-accent-ink)] hover:underline"
        >
          {t('tags.summary.viewTransactions')}
        </Link>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('tags.states.loading')}</p>
      ) : isError || !summary ? (
        <p className="text-sm text-destructive">{t('tags.states.error')}</p>
      ) : summary.transaction_count === 0 ? (
        <p className="py-6 text-center text-[12px] text-muted-foreground">{t('tags.summary.empty')}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard compact label={t('tags.summary.total')} value={formatMoney(summary.total_spent)} />
            <StatCard compact label={t('tags.summary.count')} value={summary.transaction_count} />
            <StatCard
              compact
              label={t('tags.summary.average')}
              value={formatMoney(summary.average_per_transaction)}
            />
            <StatCard compact label={t('tags.summary.dates')} value={<span className="text-[13px]">{period}</span>} />
          </div>

          <div>
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('tags.summary.byCategory')}
            </h3>
            <ul className="flex flex-col gap-2">
              {summary.by_category.map((row) => {
                const share = total > 0 ? (Number(row.amount) / total) * 100 : 0
                return (
                  <li key={row.category} className="text-[12.5px]">
                    <div className="flex justify-between gap-3">
                      <span className="truncate">{row.category}</span>
                      <span className="flex-shrink-0">
                        {formatMoney(row.amount)}{' '}
                        <span className="text-muted-foreground">({share.toFixed(0)}%)</span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--nl-bg-track)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${share}%`, background: 'var(--nl-accent)' }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>

          {summary.by_day.length > 1 && (
            <div>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t('tags.summary.byDay')}
              </h3>
              <SimpleBars
                bars={summary.by_day.map((d) => ({ label: d.date.slice(5), value: Number(d.amount) }))}
                height={150}
                showValues={summary.by_day.length <= 10}
                formatValue={(v) => formatMoney(v, { maximumFractionDigits: 0 })}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
