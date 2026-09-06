import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileBarChart,
  HeartPulse,
  Lightbulb,
  PieChart,
  PiggyBank,
  Receipt,
  RefreshCcw,
  Scale,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { HelpSection, HelpTip } from '@/components/nl/Help'
import { EmptyState, HEADER_SECTIONS, SoftBadge, SegmentedControl, StatCard, ViewHeader } from '@/components/nl/primitives'
import { LineChart, RadarChart } from '@/lib/charts'
import { useCategories } from '@/hooks/useCategories'
import {
  useCurrentMonthSummary,
  useGenerateReport,
  useGenerateYearlyReport,
  useReports,
} from '@/hooks/useReports'
import { apiErrorMessage } from '@/services/api'
import { activeDateLocale, formatMoney as formatMoneyBase } from '@/lib/utils'
import { useConfirmStore } from '@/stores/confirmStore'
import type { Report, ReportInsight, ReportInsightFlowType } from '@/types'

type Period = 'month' | 'year'
type Flow = 'all' | 'income' | 'expense'

function initialParam<T extends string>(searchParams: URLSearchParams, key: string, allowed: T[], fallback: T): T {
  const value = searchParams.get(key)
  return (allowed as string[]).includes(value ?? '') ? (value as T) : fallback
}

function formatMoney(value: string | number | undefined) {
  return formatMoneyBase(value, { maximumFractionDigits: 0 })
}

function periodLabel(report: Report): string {
  const start = new Date(report.period_start)
  if (report.type.startsWith('yearly')) return start.getFullYear().toString()
  // timeZone: 'UTC' -- `period_start` is "YYYY-MM-DD" (date with no time),
  // which Date() parses as midnight UTC; formatting in the browser's local
  // timezone can shift the day/month a period back.
  return start.toLocaleDateString(activeDateLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function buildFlowBadge(
  t: (key: string) => string,
): Record<ReportInsightFlowType, { label: string; severity: 'accent' | 'danger' | 'violet'; Icon: typeof TrendingUp }> {
  return {
    income: { label: t('reports.flowBadge.income'), severity: 'accent', Icon: TrendingUp },
    expense: { label: t('reports.flowBadge.expense'), severity: 'danger', Icon: TrendingDown },
    general: { label: t('reports.flowBadge.general'), severity: 'violet', Icon: Lightbulb },
  }
}

/** A negative savings rate (you spend more than you earn) is a real
 * warning signal -- it used to always render green regardless of the
 * value. Rule-of-thumb thresholds (10% savings = healthy), there's no
 * official standard. */
function savingsRateColor(rate: number | undefined): string {
  const value = rate ?? 0
  if (value < 0) return 'var(--nl-danger-ink)'
  if (value < 0.1) return 'var(--nl-warning-ink)'
  return 'var(--nl-accent-ink)'
}

/** A high DTI (debt/income) is the same story -- it used to show in plain
 * text no matter how high it was. >=36% is the classic "risk zone"
 * threshold in personal finance. */
function dtiColor(dti: number | undefined): string | undefined {
  const value = dti ?? 0
  if (value >= 0.36) return 'var(--nl-danger-ink)'
  if (value >= 0.2) return 'var(--nl-warning-ink)'
  return undefined
}

function InsightRow({ insight }: { insight: ReportInsight }) {
  const { t } = useTranslation('pages')
  const badge = buildFlowBadge(t)[insight.flow_type]
  const Icon = badge.Icon
  return (
    <div className="py-3 border-t border-border first:border-0">
      <div className="flex items-center gap-2 mb-1">
        <SoftBadge severity={badge.severity}>
          <span className="inline-flex items-center gap-1">
            <Icon size={11} />
            {badge.label}
          </span>
        </SoftBadge>
        {insight.category_name && (
          <span className="text-[11px] text-muted-foreground">{insight.category_name}</span>
        )}
      </div>
      <div className="text-[13px] font-medium mb-0.5">{insight.title}</div>
      <div className="text-[12.5px] text-muted-foreground">{insight.description}</div>
    </div>
  )
}

function ReportsHelp() {
  const { t } = useTranslation('pages')
  return (
    <>
      <HelpSection heading={t('reports.help.whatIsThisScreen.heading')}>
        <p>{t('reports.help.whatIsThisScreen.body')}</p>
      </HelpSection>
      <HelpSection heading={t('reports.help.generateMonthYear.heading')}>
        <p>{t('reports.help.generateMonthYear.body')}</p>
      </HelpSection>
      <HelpSection heading={t('reports.help.regenerateReport.heading')}>
        <p>{t('reports.help.regenerateReport.body')}</p>
      </HelpSection>
      <HelpSection heading={t('reports.help.incomeExpenseAll.heading')}>
        <p>{t('reports.help.incomeExpenseAll.body')}</p>
      </HelpSection>
      <HelpSection heading={t('reports.help.netWorthHistory.heading')}>
        <p>{t('reports.help.netWorthHistory.body')}</p>
      </HelpSection>
      <HelpSection heading={t('reports.help.savingsRateDtiColors.heading')}>
        <p>{t('reports.help.savingsRateDtiColors.body')}</p>
      </HelpSection>
      <HelpTip>{t('reports.help.tip')}</HelpTip>
    </>
  )
}

export function Reports() {
  const { t } = useTranslation('pages')
  const { data: current } = useCurrentMonthSummary()
  const { data: reports } = useReports(1, 48)
  const generateMonthly = useGenerateReport()
  const generateYearly = useGenerateYearlyReport()
  const [searchParams, setSearchParams] = useSearchParams()
  const period = initialParam<Period>(searchParams, 'period', ['month', 'year'], 'month')
  const flow = initialParam<Flow>(searchParams, 'flow', ['all', 'income', 'expense'], 'all')
  const { data: sideCategories } = useCategories(flow === 'income' ? 'income' : 'expense')
  const [index, setIndex] = useState(0)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  // Entry point from the sidebar ("Historial de patrimonio",
  // /reports?section=networth) -- opens the section (normally collapsed)
  // and scrolls to it. Only used as initial state: netWorthOpen stays
  // controlled by the user afterward, the link shouldn't reopen it on
  // every render.
  const [netWorthOpen, setNetWorthOpen] = useState(() => searchParams.get('section') === 'networth')
  const netWorthRef = useRef<HTMLDetailsElement>(null)
  // Copy of netWorthOpen's initial value (useRef only uses this argument
  // on the first render) -- the scroll effect must run only once when
  // entering via the deep link, not every time netWorthOpen changes
  // afterward because the user clicked the <summary>.
  const shouldScrollToNetWorth = useRef(netWorthOpen)

  useEffect(() => {
    if (shouldScrollToNetWorth.current) {
      netWorthRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  function setPeriod(next: Period) {
    setSearchParams({ period: next, flow })
    setIndex(0)
  }
  function setFlow(next: Flow) {
    setSearchParams({ period, flow: next })
  }

  const readyReports = useMemo(
    () => (reports?.items ?? []).filter((r) => r.status === 'ready' && r.summary),
    [reports],
  )
  const monthlyReports = useMemo(
    () =>
      readyReports
        .filter((r) => r.type.startsWith('monthly'))
        .slice()
        .sort((a, b) => b.period_start.localeCompare(a.period_start)),
    [readyReports],
  )
  const yearlyReports = useMemo(
    () =>
      readyReports
        .filter((r) => r.type.startsWith('yearly'))
        .slice()
        .sort((a, b) => b.period_start.localeCompare(a.period_start)),
    [readyReports],
  )
  const periodReports = period === 'month' ? monthlyReports : yearlyReports
  const report = periodReports[Math.min(index, periodReports.length - 1)]
  const summary = report?.summary

  const confirm = useConfirmStore((s) => s.ask)
  const regenerating = generateMonthly.isPending || generateYearly.isPending

  /** Recalculates the report currently being viewed from scratch -- for
   * when the user backfills old history and this period had already been
   * generated (nearly empty) before those transactions were loaded. In
   * 'year' mode it cascades: the backend recalculates the 12 months of
   * the year first, then the year (see report_service.generate_yearly_report,
   * force=True). */
  async function regenerateCurrentReport() {
    if (!report || regenerating) return
    const ok = await confirm({
      title: t('reports.confirmRegenerate.title'),
      message: t(
        period === 'year' ? 'reports.confirmRegenerate.yearlyMessage' : 'reports.confirmRegenerate.monthlyMessage',
        { period: periodLabel(report) },
      ),
      confirmLabel: t('reports.confirmRegenerate.confirmLabel'),
      variant: 'danger',
    })
    if (!ok) return
    if (period === 'year') {
      generateYearly.mutate({ year: new Date(report.period_start).getUTCFullYear(), force: true })
    } else {
      generateMonthly.mutate({
        period_start: report.period_start,
        period_end: report.period_end,
        force: true,
      })
    }
  }

  // 'all' also includes 'general' insights; filtering by income/expense
  // excludes them -- see design question resolved with the user.
  const insights = (report?.insights ?? []).filter((i) => flow === 'all' || i.flow_type === flow)
  const categorySide = flow === 'income' ? 'income' : 'expenses'
  const categories = (summary ? summary[categorySide].by_category : [])
    .slice()
    .sort((a, b) => Number(b.amount) - Number(a.amount))
    .slice(0, 8)
  // by_category only carries the name (it's an aggregate already frozen
  // into the report's JSON, not a live FK to categories) -- the real
  // color is looked up by name, same approach already used to fix the
  // same problem in Categorias/Dashboard/Transacciones/Cuentas.
  const categoryColorByName = new Map((sideCategories ?? []).map((c) => [c.name, c.color]))

  const netWorthSeries = monthlyReports
    .slice()
    .sort((a, b) => a.period_start.localeCompare(b.period_start))
  const netWorthValues = netWorthSeries.map((r) => Number(r.summary!.net_worth.end))
  const netWorthLabels = netWorthSeries.map((r) =>
    new Date(r.period_start).toLocaleDateString(activeDateLocale(), { month: 'short', timeZone: 'UTC' }),
  )

  return (
    <div>
      <ViewHeader
        icon={<FileBarChart />}
        title={t('reports.title')}
        help={<ReportsHelp />}
        section={HEADER_SECTIONS.inteligencia}
        tourKey="reports"
        actions={
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <button
              type="button"
              disabled={generateMonthly.isPending}
              onClick={() => generateMonthly.mutate({})}
              data-tour="reports:generate-month"
              className="flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[13px] border border-border text-muted-foreground hover:text-foreground disabled:opacity-60"
            >
              <FileBarChart size={14} />
              {generateMonthly.isPending ? t('reports.generating') : t('reports.generatePreviousMonth')}
            </button>
            <button
              type="button"
              disabled={generateYearly.isPending}
              onClick={() => generateYearly.mutate({ year: new Date().getFullYear() - 1 })}
              className="flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[13px] font-medium disabled:opacity-60"
              style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
            >
              <FileBarChart size={14} />
              {generateYearly.isPending ? t('reports.generating') : t('reports.generatePreviousYear')}
            </button>
          </div>
        }
      />
      {(generateMonthly.isError || generateYearly.isError) && (
        <p className="text-sm text-destructive mb-4">
          {apiErrorMessage(generateMonthly.error ?? generateYearly.error)}
        </p>
      )}

      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div data-tour="reports:period-toggle">
          <SegmentedControl
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'month', label: t('reports.period.month') },
              { value: 'year', label: t('reports.period.year') },
            ]}
          />
        </div>
        {report && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={index >= periodReports.length - 1}
              onClick={() => setIndex((i) => i + 1)}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-[13px] font-medium capitalize min-w-[140px] text-center">
              {periodLabel(report)}
            </span>
            <button
              type="button"
              disabled={index <= 0}
              onClick={() => setIndex((i) => i - 1)}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight size={14} />
            </button>
            <button
              type="button"
              title={t('reports.regenerateTooltip')}
              disabled={regenerating}
              onClick={() => void regenerateCurrentReport()}
              data-tour="reports:regenerate"
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 ml-1"
            >
              <RefreshCcw size={13} className={regenerating ? 'animate-spin' : undefined} />
            </button>
          </div>
        )}
      </div>

      {!report ? (
        <div className="bg-card border border-border rounded-md p-8 mb-4 flex flex-col items-center gap-3">
          <FileBarChart size={28} className="text-muted-foreground/40" />
          <EmptyState>
            {period === 'month' ? t('reports.emptyState.month') : t('reports.emptyState.year')}
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 mb-4 lg:flex lg:gap-3 lg:flex-wrap" data-tour="reports:stats">
            <StatCard
              compact
              icon={<TrendingUp />}
              label={t('reports.stats.income')}
              value={formatMoney(summary?.income.total)}
            />
            <StatCard
              compact
              icon={<Receipt />}
              label={t('reports.stats.expenses')}
              value={formatMoney(summary?.expenses.total)}
              valueClassName="text-[color:var(--nl-warning-ink)]"
            />
            <StatCard
              compact
              icon={<PiggyBank />}
              label={t('reports.stats.savingsRate')}
              value={
                <span style={{ color: savingsRateColor(summary?.savings_rate) }}>
                  {Math.round((summary?.savings_rate ?? 0) * 100)}%
                </span>
              }
            />
            <StatCard
              compact
              icon={<Scale />}
              label={t('reports.stats.dti')}
              value={
                <span style={{ color: dtiColor(summary?.dti) }}>
                  {Math.round((summary?.dti ?? 0) * 100)}%
                </span>
              }
            />
            <StatCard
              compact
              icon={<HeartPulse />}
              label={t('reports.stats.healthScore')}
              value={summary?.health_score.value ?? '—'}
              note={
                summary?.health_score.trend === 'improved'
                  ? t('reports.trendNote.improved')
                  : summary?.health_score.trend === 'worsened'
                    ? t('reports.trendNote.worsened')
                    : summary?.health_score.trend === 'stable'
                      ? t('reports.trendNote.stable')
                      : undefined
              }
            />
          </div>

          {summary?.adjustments && summary.adjustments.count > 0 && (
            <div
              className="flex items-center gap-3 rounded-md border p-3.5 mb-4"
              style={{ background: 'var(--nl-bg-card)', borderColor: 'var(--nl-border)' }}
              data-tour="reports:adjustments"
            >
              <RefreshCcw size={16} className="text-muted-foreground flex-shrink-0" />
              <span className="text-[13px] flex-1">
                <Trans
                  i18nKey="reports.adjustmentsNote"
                  ns="pages"
                  count={summary.adjustments.count}
                  values={{
                    count: summary.adjustments.count,
                    in: formatMoney(summary.adjustments.total_in),
                    out: formatMoney(summary.adjustments.total_out),
                    net: formatMoney(summary.adjustments.net),
                  }}
                  components={{
                    strong: <strong />,
                    net: (
                      <span
                        style={{
                          color:
                            Number(summary.adjustments.net) >= 0
                              ? 'var(--nl-accent-ink)'
                              : 'var(--nl-danger-ink)',
                        }}
                      />
                    ),
                  }}
                />
              </span>
              <Link to="/transactions" className="text-xs text-muted-foreground hover:text-foreground">
                {t('reports.viewInTransactions')}
              </Link>
            </div>
          )}

          <div className="flex justify-end mb-4" data-tour="reports:flow-filter">
            <SegmentedControl
              value={flow}
              onChange={setFlow}
              options={[
                { value: 'all', label: t('reports.flow.all') },
                { value: 'income', label: t('reports.flow.income') },
                { value: 'expense', label: t('reports.flow.expense') },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start mb-4">
            <div className="bg-card border border-border rounded-md p-4" data-tour="reports:categories">
              <div className="flex items-center gap-2 mb-2">
                <PieChart size={15} className="text-muted-foreground" />
                <div className="text-[15px] font-medium">
                  {categorySide === 'income' ? t('reports.incomeCategoriesHeading') : t('reports.expenseCategoriesHeading')}
                </div>
              </div>
              {categories.length >= 3 ? (
                <>
                  <div className="flex justify-center mb-3">
                    <RadarChart
                      axes={categories.map((c) => ({ label: c.category, value: Number(c.amount) }))}
                      color={categorySide === 'income' ? 'var(--nl-accent)' : 'var(--nl-warning)'}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {categories.map((c) => {
                      const color = categoryColorByName.get(c.category)
                      const hasSubcategories = (c.subcategories?.length ?? 0) > 0
                      const isExpanded = expandedCategories.has(c.category)
                      return (
                        <div key={c.category}>
                          <div
                            className={`flex justify-between items-center gap-2 text-[12px] ${hasSubcategories ? 'cursor-pointer' : ''}`}
                            onClick={
                              hasSubcategories
                                ? () =>
                                    setExpandedCategories((prev) => {
                                      const next = new Set(prev)
                                      if (next.has(c.category)) next.delete(c.category)
                                      else next.add(c.category)
                                      return next
                                    })
                                : undefined
                            }
                          >
                            <span className="flex items-center gap-1.5 min-w-0">
                              {hasSubcategories ? (
                                isExpanded ? (
                                  <ChevronDown size={11} className="text-muted-foreground flex-shrink-0" />
                                ) : (
                                  <ChevronRight size={11} className="text-muted-foreground flex-shrink-0" />
                                )
                              ) : (
                                <span
                                  className="w-2 h-2 rounded-sm flex-shrink-0"
                                  style={{ background: color ?? 'var(--nl-text-muted)' }}
                                />
                              )}
                              <span className="truncate text-muted-foreground">{c.category}</span>
                            </span>
                            <span className="font-medium flex-shrink-0" style={{ color }}>
                              {formatMoney(c.amount)}
                            </span>
                          </div>
                          {hasSubcategories && isExpanded && (
                            <div className="flex flex-col gap-1 mt-1 pl-4 border-l border-border">
                              {c.subcategories!.map((sub) => (
                                <div
                                  key={sub.category}
                                  className="flex justify-between items-center gap-2 text-[11px] text-muted-foreground"
                                >
                                  <span className="truncate">{sub.category}</span>
                                  <span className="flex-shrink-0">{formatMoney(sub.amount)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : categories.length > 0 ? (
                <div className="flex flex-col gap-2.5">
                  {categories.map((c) => {
                    const color = categoryColorByName.get(c.category)
                    const hasSubcategories = (c.subcategories?.length ?? 0) > 0
                    const isExpanded = expandedCategories.has(c.category)
                    return (
                      <div key={c.category}>
                        <div
                          className={`flex justify-between items-center gap-2 text-[12px] mb-1 ${hasSubcategories ? 'cursor-pointer' : ''}`}
                          onClick={
                            hasSubcategories
                              ? () =>
                                  setExpandedCategories((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(c.category)) next.delete(c.category)
                                    else next.add(c.category)
                                    return next
                                  })
                              : undefined
                          }
                        >
                          <span className="flex items-center gap-1.5 min-w-0">
                            {hasSubcategories ? (
                              isExpanded ? (
                                <ChevronDown size={11} className="text-muted-foreground flex-shrink-0" />
                              ) : (
                                <ChevronRight size={11} className="text-muted-foreground flex-shrink-0" />
                              )
                            ) : (
                              <span
                                className="w-2 h-2 rounded-sm flex-shrink-0"
                                style={{ background: color ?? 'var(--nl-text-muted)' }}
                              />
                            )}
                            <span className="truncate">{c.category}</span>
                          </span>
                          <span className="font-medium flex-shrink-0" style={{ color }}>
                            {formatMoney(c.amount)}
                          </span>
                        </div>
                      <div className="h-[5px] rounded-full overflow-hidden" style={{ background: 'var(--nl-bg-track)' }}>
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.round((Number(c.amount) / (Number(categories[0]?.amount) || 1)) * 100)}%`,
                            background: color ?? (categorySide === 'income' ? 'var(--nl-accent)' : 'var(--nl-warning)'),
                          }}
                        />
                      </div>
                      {hasSubcategories && isExpanded && (
                        <div className="flex flex-col gap-1 mt-1.5 pl-4 border-l border-border">
                          {c.subcategories!.map((sub) => (
                            <div
                              key={sub.category}
                              className="flex justify-between items-center gap-2 text-[11px] text-muted-foreground"
                            >
                              <span className="truncate">{sub.category}</span>
                              <span className="flex-shrink-0">{formatMoney(sub.amount)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('reports.noCategoryMovements')}</p>
              )}
            </div>

            <div className="bg-card border border-border rounded-md p-4">
              <div className="flex items-center gap-2 mb-1">
                <Lightbulb size={15} className="text-muted-foreground" />
                <div className="text-[15px] font-medium">{t('reports.periodPointsHeading')}</div>
              </div>
              <p className="text-[11px] text-muted-foreground mb-2">{t('reports.periodPointsSubtitle')}</p>
              {insights.length > 0 ? (
                insights.map((i) => <InsightRow key={i.id} insight={i} />)
              ) : (
                <p className="text-sm text-muted-foreground py-4">{t('reports.noPointsForFilter')}</p>
              )}
            </div>
          </div>

          <details
            ref={netWorthRef}
            open={netWorthOpen}
            onToggle={(e) => setNetWorthOpen(e.currentTarget.open)}
            className="bg-card border border-border rounded-md p-4"
            data-tour="reports:networth"
          >
            <summary className="flex items-center gap-2 text-[15px] font-medium cursor-pointer select-none">
              <TrendingUp size={15} className="text-muted-foreground" />
              {t('reports.netWorthHeading')}
            </summary>
            <div className="mt-4">
              {netWorthValues.length >= 2 ? (
                <LineChart series={netWorthValues} xLabels={netWorthLabels} height={220} />
              ) : (
                <p className="text-sm text-muted-foreground py-6 text-center">{t('reports.netWorthEmpty')}</p>
              )}
            </div>
          </details>
        </>
      )}

      {current && (
        <p className="text-[11px] text-muted-foreground mt-4">
          {t('reports.currentMonthNote', {
            income: formatMoney(current.income.total),
            expenses: formatMoney(current.expenses.total),
          })}
        </p>
      )}
    </div>
  )
}
