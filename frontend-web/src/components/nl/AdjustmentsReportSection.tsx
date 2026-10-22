import { Scale } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAdjustmentsReport } from '@/hooks/useReports'
import { activeDateLocale, formatMoney } from '@/lib/utils'

/** Reports section: the money that went missing (or showed up) with no explanation, month by month. */
export function AdjustmentsReportSection() {
  const { t } = useTranslation('pages')
  const { data } = useAdjustmentsReport(12)
  const months = [...(data?.months ?? [])].reverse()
  const hasAdjustments = (data?.total.count ?? 0) > 0

  return (
    <details className="bg-card border border-border rounded-md p-4 mt-4" data-tour="reports:unidentified">
      <summary className="flex items-center gap-2 text-[15px] font-medium cursor-pointer select-none">
        <Scale size={15} className="text-muted-foreground" />
        {t('reports.unidentified.heading')}
      </summary>
      <p className="mt-3 text-[12.5px] text-muted-foreground">{t('reports.unidentified.intro')}</p>
      {!hasAdjustments ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t('reports.unidentified.empty')}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[13px] tabular-nums" data-testid="unidentified-table">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1.5 pr-3 font-semibold">{t('reports.unidentified.month')}</th>
                <th className="py-1.5 pr-3 text-right font-semibold">{t('reports.unidentified.exits')}</th>
                <th className="py-1.5 pr-3 text-right font-semibold">{t('reports.unidentified.entries')}</th>
                <th className="py-1.5 pr-3 text-right font-semibold">{t('reports.unidentified.net')}</th>
                <th className="py-1.5 pr-3 text-right font-semibold">{t('reports.unidentified.count')}</th>
                <th className="py-1.5 text-right font-semibold">{t('reports.unidentified.share')}</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} className="border-t border-border">
                  <td className="py-1.5 pr-3">
                    {new Date(`${m.month}-01T00:00:00`).toLocaleDateString(activeDateLocale(), {
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="py-1.5 pr-3 text-right">{formatMoney(m.total_out)}</td>
                  <td className="py-1.5 pr-3 text-right">{formatMoney(m.total_in)}</td>
                  <td
                    className="py-1.5 pr-3 text-right"
                    style={{ color: Number(m.net) >= 0 ? 'var(--nl-accent-ink)' : 'var(--nl-danger-ink)' }}
                  >
                    {formatMoney(m.net)}
                  </td>
                  <td className="py-1.5 pr-3 text-right">{m.count}</td>
                  <td className="py-1.5 text-right">{m.count > 0 ? `${Math.round(m.unidentified_share * 100)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td className="py-1.5 pr-3">{t('reports.unidentified.total')}</td>
                <td className="py-1.5 pr-3 text-right">{formatMoney(data!.total.total_out)}</td>
                <td className="py-1.5 pr-3 text-right">{formatMoney(data!.total.total_in)}</td>
                <td className="py-1.5 pr-3 text-right">{formatMoney(data!.total.net)}</td>
                <td className="py-1.5 pr-3 text-right">{data!.total.count}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </details>
  )
}
