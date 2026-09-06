import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Lock,
  PiggyBank,
  Plus,
  Receipt,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { DialogFooter, DialogPrimaryButton } from '@/components/nl/DialogActions'
import { HelpSection, HelpTip } from '@/components/nl/Help'
import { HEADER_SECTIONS, ProgressBar, StatCard, ViewHeader } from '@/components/nl/primitives'
import { Donut, SimpleBars } from '@/lib/charts'
import {
  useBudgetForMonth,
  useBudgetLimitSuggestions,
  useBudgetTrend,
  useBudgetWeekly,
  useSetBudgetLimits,
} from '@/hooks/useBudget'
import { useRecurringItems } from '@/hooks/useRecurring'
import { apiErrorMessage } from '@/services/api'
import { activeDateLocale, formatMoney, selectClass } from '@/lib/utils'
import type { BudgetCategoryBreakdown } from '@/types'

const DONUT_COLORS = [
  'var(--nl-accent)',
  'var(--nl-blue)',
  'var(--nl-warning)',
  'var(--nl-violet)',
  'var(--nl-danger)',
  'var(--nl-pink)',
]

function barColor(pct: number) {
  if (pct >= 90) return 'var(--nl-danger)'
  if (pct >= 70) return 'var(--nl-warning)'
  return 'var(--nl-accent)'
}

function barColorInk(pct: number) {
  if (pct >= 90) return 'var(--nl-danger-ink)'
  if (pct >= 70) return 'var(--nl-warning-ink)'
  return 'var(--nl-accent-ink)'
}

/** Edits the limit for ALL expense categories on a single screen instead of
 * one at a time -- the backend already did an upsert per category
 * (budget_service.set_limits), so sending several at once with
 * useSetBudgetLimits doesn't overwrite the ones left untouched, it just
 * needed a form that took advantage of that. useBudgetLimitSuggestions
 * (unlike useBudgetCurrent) brings ALL expense categories with their real
 * color and their average from the last 3 months, including ones that
 * never had a limit -- that's where both the dot color and the suggestion
 * come from. */
function SetLimitsForm({ onDone, viewingPastMonth }: { onDone: () => void; viewingPastMonth?: boolean }) {
  const { t } = useTranslation('pages')
  const { data: suggestions } = useBudgetLimitSuggestions()
  const setLimits = useSetBudgetLimits()
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!suggestions) return
    setValues((prev) => {
      const next = { ...prev }
      for (const s of suggestions) {
        if (!(s.category_id in next)) next[s.category_id] = s.current_limit ?? ''
      }
      return next
    })
  }, [suggestions])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const limits = Object.entries(values)
      .filter(([, v]) => v.trim() !== '' && Number(v) > 0)
      .map(([category_id, monthly_limit]) => ({ category_id, monthly_limit }))
    if (limits.length === 0) return
    try {
      await setLimits.mutateAsync(limits)
      onDone()
    } catch {
      // error shown below
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-[12px] text-muted-foreground">
        {t('budget.setLimits.description')}
        {viewingPastMonth && ` ${t('budget.setLimits.pastMonthNote')}`}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 max-h-[55vh] overflow-y-auto -mx-1 px-1 py-1">
        {(suggestions ?? []).map((s) => {
          const average = Number(s.average_last_3_months)
          return (
            <div key={s.category_id} className="rounded-md border border-border p-2.5 flex flex-col gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                <span className="text-[13px] truncate">{s.category_name}</span>
              </div>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground pointer-events-none">
                  $
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder={t('budget.setLimits.noLimitPlaceholder')}
                  value={values[s.category_id] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [s.category_id]: e.target.value }))}
                  className={`${selectClass} h-8 w-full pl-5 text-right`}
                />
              </div>
              {average > 0 && (
                <button
                  type="button"
                  onClick={() => setValues((prev) => ({ ...prev, [s.category_id]: s.average_last_3_months }))}
                  className="text-[11px] text-muted-foreground hover:text-foreground text-left"
                >
                  {t('budget.setLimits.average3MonthsLabel')}{' '}
                  <span className="font-medium">{formatMoney(s.average_last_3_months)}</span>
                </button>
              )}
            </div>
          )
        })}
        {(suggestions ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground py-2 col-span-2">{t('budget.setLimits.noExpenseCategories')}</p>
        )}
      </div>
      {setLimits.isError && <p className="text-sm text-destructive">{apiErrorMessage(setLimits.error)}</p>}
      <DialogFooter>
        <DialogPrimaryButton icon={Check} pending={setLimits.isPending}>
          {t('budget.setLimits.saveChanges')}
        </DialogPrimaryButton>
      </DialogFooter>
    </form>
  )
}

function CategoryRow({
  category,
  color,
  prevSpent,
  showSuggestions = true,
}: {
  category: BudgetCategoryBreakdown
  color: string
  /** This same category's expense in the previous month -- undefined if
   * there's no data (new category or previous month with no transactions)
   * so we don't show an arrow with a false 0. */
  prevSpent?: number
  /** average_last_3_months is always calculated relative to TODAY (not the
   * month being viewed) -- showing the limit suggestion while navigating a
   * past month would mix a "today" data point with a historical row. */
  showSuggestions?: boolean
}) {
  const { t } = useTranslation('pages')
  const setLimit = useSetBudgetLimits()
  const average = Number(category.average_last_3_months)
  const limit = Number(category.monthly_limit)
  const spent = Number(category.spent)
  // Only worth suggesting the average if there's data and it genuinely
  // differs from the current limit -- if they already match (or there's no
  // history) there's nothing to suggest.
  const showSuggestion = showSuggestions && average > 0 && Math.abs(average - limit) >= 1
  // +/-5% is treated as "the same" so we don't show an arrow for minimal noise.
  const deltaPct = prevSpent && prevSpent > 0 ? ((spent - prevSpent) / prevSpent) * 100 : null
  const trend = deltaPct === null || Math.abs(deltaPct) < 5 ? null : deltaPct > 0 ? 'up' : 'down'

  const trendIcon = trend && (
    <span
      className="flex items-center gap-0.5"
      style={{ color: trend === 'up' ? 'var(--nl-danger-ink)' : 'var(--nl-accent-ink)' }}
      title={t('budget.categoryRow.vsLastMonth', { pct: `${trend === 'up' ? '+' : ''}${Math.round(deltaPct as number)}` })}
    >
      {trend === 'up' ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
    </span>
  )

  return (
    <div className="py-3 border-t border-border first:border-0">
      {/* Table row -- lg+ only */}
      <div className="hidden lg:grid grid-cols-[1fr_140px_90px_50px_90px] gap-3 items-center">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: color }} />
          <span className="text-[13px] truncate">{category.category_name}</span>
        </div>
        <ProgressBar pct={category.percentage} color={barColor(category.percentage)} />
        <span className="text-right text-[13px] text-muted-foreground">{formatMoney(category.spent)}</span>
        <span className="flex items-center justify-end gap-0.5 text-[11px]">{trendIcon}</span>
        <span className="text-right text-[13px]" style={{ color: category.alert ? 'var(--nl-danger-ink)' : undefined }}>
          {category.percentage}%
        </span>
      </div>

      {/* Card -- mobile only */}
      <div className="lg:hidden flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: color }} />
            <span className="text-[13px] truncate">{category.category_name}</span>
            {trendIcon}
          </div>
          <span
            className="text-[13px] flex-shrink-0"
            style={{ color: category.alert ? 'var(--nl-danger-ink)' : undefined }}
          >
            {formatMoney(category.spent)} · {category.percentage}%
          </span>
        </div>
        <ProgressBar pct={category.percentage} color={barColor(category.percentage)} />
      </div>

      {showSuggestion && (
        <div
          className="flex items-center gap-2 flex-wrap mt-1.5 pl-4 text-[11px] text-muted-foreground"
          data-tour="budget:suggestion"
        >
          <span>
            {t('budget.categoryRow.average3MonthsLabel')}{' '}
            <span className="font-medium">{formatMoney(category.average_last_3_months)}</span>
            {average > limit ? t('budget.categoryRow.aboveLimit') : t('budget.categoryRow.belowLimit')}
          </span>
          <button
            type="button"
            disabled={setLimit.isPending}
            onClick={() =>
              setLimit.mutate([
                { category_id: category.category_id, monthly_limit: category.average_last_3_months },
              ])
            }
            className="rounded px-2 py-0.5 border border-border hover:text-foreground disabled:opacity-40 flex-shrink-0"
          >
            {t('budget.categoryRow.useThisAmount')}
          </button>
        </div>
      )}
    </div>
  )
}

function BudgetHelp() {
  const { t } = useTranslation('pages')
  return (
    <>
      <HelpSection heading={t('budget.help.whatIsThisScreen.heading')}>
        <p>{t('budget.help.whatIsThisScreen.body')}</p>
      </HelpSection>
      <HelpSection heading={t('budget.help.settingLimit.heading')}>
        <p>{t('budget.help.settingLimit.body')}</p>
      </HelpSection>
      <HelpSection heading={t('budget.help.limitSuggestion.heading')}>
        <p>{t('budget.help.limitSuggestion.body')}</p>
      </HelpSection>
      <HelpSection heading={t('budget.help.available.heading')}>
        <p>{t('budget.help.available.body')}</p>
      </HelpSection>
      <HelpSection heading={t('budget.help.navigatingPastMonths.heading')}>
        <p>{t('budget.help.navigatingPastMonths.body')}</p>
      </HelpSection>
      <HelpSection heading={t('budget.help.categoryArrow.heading')}>
        <p>{t('budget.help.categoryArrow.body')}</p>
      </HelpSection>
      <HelpTip>{t('budget.help.fixedCommittedTip')}</HelpTip>
    </>
  )
}

// Built fresh on every call (not cached at module scope) so it always
// reflects the active language, not just the one in effect when this
// module first loaded.
function monthFormatter(style: 'short' | 'long'): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(activeDateLocale(), {
    month: style,
    ...(style === 'long' ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  })
}

function monthLabel(year: number, month: number, style: 'short' | 'long' = 'long') {
  const label = monthFormatter(style).format(new Date(Date.UTC(year, month - 1, 1)))
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function Budget() {
  const { t } = useTranslation('pages')
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1
  const [viewed, setViewed] = useState({ year: currentYear, month: currentMonth })
  const isCurrentMonth = viewed.year === currentYear && viewed.month === currentMonth
  const prevOfViewed =
    viewed.month === 1 ? { year: viewed.year - 1, month: 12 } : { year: viewed.year, month: viewed.month - 1 }

  const { data: current, isLoading } = useBudgetForMonth(viewed.year, viewed.month)
  const { data: prevMonthData } = useBudgetForMonth(prevOfViewed.year, prevOfViewed.month)
  const { data: weekly } = useBudgetWeekly()
  const { data: trend } = useBudgetTrend()
  const { data: recurring } = useRecurringItems({ status: 'active' })
  const [open, setOpen] = useState(false)

  function goToPrevMonth() {
    setViewed(prevOfViewed)
  }
  function goToNextMonth() {
    if (isCurrentMonth) return
    setViewed(
      viewed.month === 12 ? { year: viewed.year + 1, month: 1 } : { year: viewed.year, month: viewed.month + 1 },
    )
  }

  const weekTotals = weekly?.weeks.map((week) => ({
    week: week.week,
    date_from: week.date_from,
    date_to: week.date_to,
    total: Object.values(week.spent_by_category).reduce((acc, amount) => acc + Number(amount), 0),
  }))

  const prevSpentByCategory = new Map(
    (prevMonthData?.variable_categories ?? []).map((c) => [c.category_id, Number(c.spent)]),
  )

  const categories = current?.variable_categories ?? []
  const alertCategories = categories.filter((c) => c.alert)
  const donutSlices = categories
    .filter((c) => Number(c.spent) > 0)
    .map((c, i) => ({ value: Number(c.spent), color: DONUT_COLORS[i % DONUT_COLORS.length], name: c.category_name }))

  const budgeted = Number(current?.variable_total_budgeted ?? 0)
  const spent = Number(current?.variable_total_spent ?? 0)
  const spentPct = budgeted > 0 ? Math.round((spent / budgeted) * 100) : 0
  const daysLeftInMonth = new Date(currentYear, currentMonth, 0).getDate() - now.getDate()

  // A month with no limit defined at all arrives with budgeted=0 and
  // percentage=0 -- that doesn't mean "you spent 0%", it means "that month
  // had nothing to compare against". Showing it anyway as a 0% bar fills
  // the chart with months that carry no real information, and reads as
  // flat noise instead of a trend.
  const trendBars = (trend ?? [])
    .filter((m) => Number(m.budgeted) > 0)
    .map((m) => ({
      label: monthLabel(m.year, m.month, 'short'),
      value: m.percentage,
      color: barColor(m.percentage),
    }))

  return (
    <div>
      <ViewHeader
        icon={<PiggyBank />}
        title={t('budget.title')}
        help={<BudgetHelp />}
        section={HEADER_SECTIONS.diario}
        tourKey="budget"
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger
              render={
                <button
                  type="button"
                  data-tour="budget:new-limit"
                  className="flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[13px] font-medium"
                  style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
                >
                  <Plus size={14} />
                  {t('budget.defineLimit')}
                </button>
              }
            />
            <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{t('budget.limitsDialogTitle')}</DialogTitle>
              </DialogHeader>
              <SetLimitsForm onDone={() => setOpen(false)} viewingPastMonth={!isCurrentMonth} />
            </DialogContent>
          </Dialog>
        }
      />

      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1" data-tour="budget:month-nav">
          <button
            type="button"
            onClick={goToPrevMonth}
            className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted"
            aria-label={t('budget.previousMonth')}
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-[14px] font-medium min-w-[150px] text-center">
            {monthLabel(viewed.year, viewed.month)}
          </span>
          <button
            type="button"
            onClick={goToNextMonth}
            disabled={isCurrentMonth}
            className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label={t('budget.nextMonth')}
          >
            <ChevronRight size={18} />
          </button>
          {!isCurrentMonth && (
            <button
              type="button"
              onClick={() => setViewed({ year: currentYear, month: currentMonth })}
              className="ml-2 text-[12px] text-muted-foreground hover:text-foreground underline"
            >
              {t('budget.backToToday')}
            </button>
          )}
        </div>
        <Link
          to="/reports?period=month&flow=expense"
          className="text-[12px] text-muted-foreground hover:text-foreground"
        >
          {t('budget.viewFullMonthReport')}
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2.5 mb-4 lg:flex lg:gap-3 lg:flex-wrap">
        <StatCard
          compact
          icon={<Target />}
          label={t('budget.stats.budgeted')}
          value={formatMoney(current?.variable_total_budgeted ?? '0')}
          note={t('budget.categoriesWithLimit', { count: categories.length })}
        />
        <StatCard
          compact
          icon={<Receipt />}
          label={t('budget.stats.spent')}
          value={<span style={{ color: barColorInk(spentPct) }}>{formatMoney(current?.variable_total_spent ?? '0')}</span>}
          borderColor={barColor(spentPct)}
          note={t('budget.stats.spentPctNote', { pct: spentPct })}
        />
        <StatCard
          compact
          icon={<PiggyBank />}
          label={t('budget.stats.available')}
          dataTour="budget:available"
          value={
            <span style={{ color: Number(current?.available ?? 0) < 0 ? 'var(--nl-danger-ink)' : 'var(--nl-accent-ink)' }}>
              {formatMoney(current?.available ?? '0')}
            </span>
          }
          note={
            <>
              {t('budget.stats.estimatedIncomeLabel')}
              {formatMoney(current?.income_estimated ?? '0')}
              {isCurrentMonth && <> · {t('budget.daysLeft', { count: daysLeftInMonth })}</>}
            </>
          }
        />
        <StatCard
          compact
          icon={<Lock />}
          label={t('budget.stats.committedFixed')}
          value={formatMoney(current?.committed_fixed ?? '0')}
          note={t('budget.stats.debtsAndRecurringNote')}
          dataTour="budget:committed"
        />
      </div>

      {isCurrentMonth && alertCategories.length > 0 && (
        <div className="bg-card border border-border rounded-md p-3.5 mb-4" data-tour="budget:alerts">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={15} className="text-muted-foreground flex-shrink-0" />
            <span className="text-[13px] font-medium">
              {t('budget.categoriesNearOrOverLimit', { count: alertCategories.length })}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {alertCategories.map((c) => {
              const over = c.percentage >= 100
              return (
                <span
                  key={c.category_id}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px]"
                  style={{
                    background: over ? 'var(--nl-danger-soft-bg)' : 'var(--nl-warning-soft-bg)',
                    color: over ? 'var(--nl-danger-ink)' : 'var(--nl-warning-ink)',
                  }}
                >
                  {c.category_name}
                  <span className="font-semibold">{c.percentage}%</span>
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Same regular 4-column grid as Home -- each card takes up 2 of 4
          (half), except Trend, which spans up to 12 months of bars and
          stays full width (4 of 4). "2x2, 4x2": fixed-size blocks within
          the same grid, not custom per-row fractions. */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">
        <div className="lg:col-span-2 bg-card border border-border rounded-md p-4">
          <div className="text-[15px] font-medium mb-2">{t('budget.breakdownByCategory')}</div>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t('budget.loading')}</p>
          ) : categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('budget.noCategoriesYet')}</p>
          ) : (
            categories.map((c, i) => (
              <CategoryRow
                key={c.category_id}
                category={c}
                color={DONUT_COLORS[i % DONUT_COLORS.length]}
                prevSpent={prevSpentByCategory.get(c.category_id)}
                showSuggestions={isCurrentMonth}
              />
            ))
          )}
        </div>

        <div className="lg:col-span-2 bg-card border border-border rounded-md p-4" data-tour="budget:distribution">
          <div className="text-[15px] font-medium mb-2">{t('budget.expenseDistribution')}</div>
          {donutSlices.length > 0 ? (
            <div className="flex flex-col items-center gap-3">
              <Donut
                slices={donutSlices}
                centerLabel={formatMoney(current?.variable_total_spent ?? '0')}
                centerSub={isCurrentMonth ? t('budget.thisMonth') : monthLabel(viewed.year, viewed.month, 'short')}
              />
              <div className="flex flex-col gap-1.5 w-full">
                {donutSlices.map((s) => (
                  <div key={s.name} className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: s.color }} />
                    <span className="text-[11px] text-muted-foreground truncate flex-1">{s.name}</span>
                    <span className="text-[11px]">{Math.round((s.value / (Number(current?.variable_total_spent) || 1)) * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {isCurrentMonth ? t('budget.noExpensesThisMonth') : t('budget.noExpensesThatMonth')}
            </p>
          )}
        </div>

        <div className="lg:col-span-2 bg-card border border-border rounded-md p-4">
          <div className="text-[15px] font-medium mb-2">{t('budget.recurringPayments')}</div>
          <div className="flex flex-col">
            {(recurring ?? []).slice(0, 6).map((r) => (
              <div key={r.id} className="flex items-center gap-2 py-2 border-t border-border first:border-0">
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: r.status === 'active' ? 'var(--nl-accent)' : 'var(--nl-text-muted)' }}
                />
                <span className="text-[13px] flex-1 truncate">{r.name}</span>
                <span className="text-[13px] text-muted-foreground">{formatMoney(r.amount)}</span>
              </div>
            ))}
            {(recurring ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">{t('budget.noActiveRecurring')}</p>
            )}
          </div>
        </div>

        {isCurrentMonth ? (
          weekTotals && weekTotals.length > 0 && (
            <div className="lg:col-span-2 bg-card border border-border rounded-md p-4">
              <div className="text-[15px] font-medium mb-2">{t('budget.weeklyView')}</div>
              <SimpleBars
                bars={weekTotals.map((w) => ({ label: t('budget.weekShortLabel', { week: w.week }), value: w.total }))}
                height={110}
                showValues
                formatValue={(v) => formatMoney(v.toFixed(2))}
              />
              <div className="flex flex-col mt-2">
                {weekTotals.map((week) => (
                  <div key={week.week} className="flex items-center justify-between py-2 border-t border-border first:border-0 text-[13px]">
                    <span className="text-muted-foreground">
                      {t('budget.weekRange', { week: week.week, from: week.date_from, to: week.date_to })}
                    </span>
                    <span className="font-medium">{formatMoney(week.total.toFixed(2))}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        ) : (
          <div className="lg:col-span-2 bg-card border border-border rounded-md p-4 flex flex-col items-center justify-center text-center gap-2 min-h-[180px]">
            <p className="text-sm text-muted-foreground">
              {t('budget.weeklyViewCurrentMonthOnly')}
            </p>
            <button
              type="button"
              onClick={() => setViewed({ year: currentYear, month: currentMonth })}
              className="text-[12px] text-muted-foreground hover:text-foreground underline"
            >
              {t('budget.backToTodayToSee')}
            </button>
          </div>
        )}

        {trendBars.length > 0 && (
          <div className="lg:col-span-4 bg-card border border-border rounded-md p-3.5" data-tour="budget:trend">
            <div className="text-[13px] font-medium mb-1.5">{t('budget.trendHeading')}</div>
            <SimpleBars bars={trendBars} height={70} showValues formatValue={(v) => `${Math.round(v)}%`} />
          </div>
        )}
      </div>
    </div>
  )
}
