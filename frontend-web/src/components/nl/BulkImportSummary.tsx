import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { BulkImportPreview } from '@/hooks/useBulkImport'
import { formatMoney } from '@/lib/utils'

const MAX_CATEGORIES = 8
const MAX_ERRORS = 10

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border p-3" style={{ background: 'var(--nl-bg-input)' }}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-[17px] font-semibold">{value}</div>
      {sub && <div className="text-[11.5px] text-muted-foreground">{sub}</div>}
    </div>
  )
}

/** What loading the file would do, in short: totals, where it goes, and what is
 * wrong or looks already loaded. Shown BEFORE anything is saved. */
export function BulkImportSummary({ preview }: { preview: BulkImportPreview }) {
  const { t } = useTranslation('pages')
  const { income, expense, possible_duplicates: dupes } = preview
  const categories = preview.by_category.slice(0, MAX_CATEGORIES)
  const hiddenCategories = preview.by_category.length - categories.length

  return (
    <div className="flex flex-col gap-4" data-testid="bulk-summary">
      <div className="flex items-center gap-2 text-[14px] font-semibold">
        <CheckCircle2 size={16} style={{ color: 'var(--nl-accent-ink)' }} />
        {t('bulkImport.summary.ready', { count: preview.valid_rows })}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={t('bulkImport.summary.income')}
          value={formatMoney(income.total)}
          sub={t('bulkImport.summary.movements', { count: income.count })}
        />
        <Stat
          label={t('bulkImport.summary.expenses')}
          value={formatMoney(expense.total)}
          sub={t('bulkImport.summary.movements', { count: expense.count })}
        />
        <Stat
          label={t('bulkImport.summary.net')}
          value={formatMoney(Number(income.total) - Number(expense.total))}
        />
        <Stat
          label={t('bulkImport.summary.dates')}
          value={
            preview.date_from
              ? preview.date_from === preview.date_to
                ? preview.date_from
                : `${preview.date_from} → ${preview.date_to}`
              : '—'
          }
        />
      </div>

      {preview.by_account.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('bulkImport.summary.byAccount')}
          </h3>
          <ul className="flex flex-col gap-1 text-[12.5px]">
            {preview.by_account.map((a) => (
              <li key={a.name} className="flex justify-between gap-3">
                <span>
                  {a.name} <span className="text-muted-foreground">({t('bulkImport.summary.movements', { count: a.count })})</span>
                </span>
                <span className="text-muted-foreground">
                  +{formatMoney(a.income)} / −{formatMoney(a.expense)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {categories.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('bulkImport.summary.byCategory')}
          </h3>
          <ul className="flex flex-col gap-1 text-[12.5px]">
            {categories.map((c) => (
              <li key={`${c.type}-${c.name}`} className="flex justify-between gap-3">
                <span className="truncate">
                  {c.name} <span className="text-muted-foreground">({c.count})</span>
                </span>
                <span style={c.type === 'income' ? { color: 'var(--nl-accent-ink)' } : undefined}>
                  {formatMoney(c.total)}
                </span>
              </li>
            ))}
          </ul>
          {hiddenCategories > 0 && (
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              {t('bulkImport.summary.moreCategories', { count: hiddenCategories })}
            </p>
          )}
        </section>
      )}

      {preview.by_tag.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('bulkImport.summary.byTag')}
          </h3>
          <ul className="flex flex-col gap-1 text-[12.5px]">
            {preview.by_tag.map((tag) => (
              <li key={tag.name} className="flex justify-between gap-3">
                <span>
                  {tag.name} <span className="text-muted-foreground">({tag.count})</span>
                </span>
                <span>{formatMoney(tag.total)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dupes.count > 0 && (
        <div
          role="alert"
          className="rounded-md border p-3 text-[12.5px]"
          style={{ borderColor: 'var(--nl-warning, #f5a623)', background: 'var(--nl-bg-input)' }}
        >
          <div className="mb-1 flex items-center gap-2 font-semibold">
            <AlertTriangle size={14} style={{ color: 'var(--nl-warning, #f5a623)' }} />
            {t('bulkImport.summary.duplicatesTitle', { count: dupes.count })}
          </div>
          <p className="text-muted-foreground">{t('bulkImport.summary.duplicatesBody')}</p>
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {dupes.examples.map((d) => (
              <li key={d.row}>
                {t('bulkImport.summary.row', { row: d.row })}: {d.date} · {formatMoney(d.amount)} · {d.description}
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview.errors.length > 0 && (
        <div
          role="alert"
          className="rounded-md border p-3 text-[12.5px]"
          style={{ borderColor: 'var(--nl-danger-ink)', background: 'var(--nl-bg-input)' }}
        >
          <div className="mb-1 font-semibold" style={{ color: 'var(--nl-danger-ink)' }}>
            {t('bulkImport.summary.errorsTitle', { count: preview.error_rows })}
          </div>
          <ul className="flex flex-col gap-0.5">
            {preview.errors.slice(0, MAX_ERRORS).map((e, i) => (
              <li key={i}>
                {t('bulkImport.summary.row', { row: e.row })}
                {e.block ? ` (${e.block})` : ''}: {e.reason}
              </li>
            ))}
          </ul>
          {preview.errors.length > MAX_ERRORS && (
            <p className="mt-1 text-muted-foreground">
              {t('bulkImport.summary.moreErrors', { count: preview.errors.length - MAX_ERRORS })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
