import { AlertTriangle, Calendar, Droplet, Grid2x2, Home, Clock, TrendingDown, TrendingUp } from 'lucide-react'
import { useMemo } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Link } from 'react-router-dom'
import { GroupedBars, LineChart } from '@/lib/charts'
import {
  accountSubtypeLabel,
  activeDateLocale,
  entryTypeLabel,
  formatMoney as formatMoneyBase,
  formatShortDate,
  isPositiveEntryType,
} from '@/lib/utils'
import { HelpSection, HelpTip } from '@/components/nl/Help'
import { CategoryBadge, HEADER_SECTIONS, Legend, StatCard, ViewHeader } from '@/components/nl/primitives'
import { useAccounts } from '@/hooks/useAccounts'
import { useBudgetCurrent, useBudgetWeekly } from '@/hooks/useBudget'
import { useCategories } from '@/hooks/useCategories'
import { useDebts } from '@/hooks/useDebts'
import { useFinancialSnapshot } from '@/hooks/useEngine'
import { useInsights } from '@/hooks/useInsights'
import { useRecurringItems } from '@/hooks/useRecurring'
import { useCurrentMonthSummary, useReports } from '@/hooks/useReports'
import { useTransactions } from '@/hooks/useTransactions'
import { useAuthStore } from '@/stores/authStore'

function formatMoney(value: string | number | undefined) {
  return formatMoneyBase(value, { maximumFractionDigits: 0 })
}

function greeting(t: (key: string) => string): string {
  const hour = new Date().getHours()
  if (hour < 12) return t('dashboard.greeting.morning')
  if (hour < 19) return t('dashboard.greeting.afternoon')
  return t('dashboard.greeting.evening')
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function todayLabel(): string {
  return capitalize(
    new Date().toLocaleDateString(activeDateLocale(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  )
}

function weekdayShort(t: TFunction, dayIndex: number): string {
  return (t('dashboard.weekdayShort', { returnObjects: true }) as string[])[dayIndex]
}

function DashboardHelp() {
  const { t } = useTranslation('pages')
  return (
    <>
      <HelpSection heading={t('dashboard.help.whatIsThisScreen.heading')}>
        <p>{t('dashboard.help.whatIsThisScreen.body')}</p>
      </HelpSection>
      <HelpSection heading={t('dashboard.help.cardsAbove.heading')}>
        <p>
          <Trans i18nKey="dashboard.help.cardsAbove.body" ns="pages">
            <strong>Liquidity</strong> adds up the balance of your cash/bank-type accounts (not credit cards). <strong>Revolving debt</strong> is what you owe on active credit cards, with its average APR. <strong>Month budget</strong> and <strong>week budget</strong> show what percentage you've spent against what was budgeted — the color changes from green to orange to red depending on how close you are to the limit. As soon as you generate the current month's report (Reports → Generate), two more cards appear: <strong>Month income</strong> and <strong>Month expenses</strong>, each compared against the previous month.
          </Trans>
        </p>
      </HelpSection>
      <HelpSection heading={t('dashboard.help.upcomingPayments.heading')}>
        <p>{t('dashboard.help.upcomingPayments.body')}</p>
      </HelpSection>
      <HelpSection heading={t('dashboard.help.netWorthAndDebts.heading')}>
        <p>{t('dashboard.help.netWorthAndDebts.body')}</p>
      </HelpSection>
      <HelpTip>{t('dashboard.help.readOnlyTip')}</HelpTip>
    </>
  )
}

export function Dashboard() {
  const { t } = useTranslation('pages')
  const user = useAuthStore((s) => s.user)
  const { data: snapshot, isLoading: loadingSnapshot } = useFinancialSnapshot()
  const { data: accounts } = useAccounts()
  const { data: debts } = useDebts()
  const { data: budgetCurrent } = useBudgetCurrent()
  const { data: budgetWeekly } = useBudgetWeekly()
  const { data: recentTx } = useTransactions({ per_page: 30 })
  const { data: recurring } = useRecurringItems({ status: 'active' })
  const { data: insights } = useInsights()
  const { data: reportsData } = useReports(1, 12)
  const { data: currentMonthSummary } = useCurrentMonthSummary()
  const { data: categories } = useCategories()
  const categoryColorById = new Map((categories ?? []).map((c) => [c.id, c.color]))

  const liquidAccounts = accounts?.filter((a) => a.type === 'asset') ?? []
  // Revolving debt comes from Account, not Debt: a credit card is a full
  // account on its own (see the redesign that took credit cards out of the
  // Debts model) -- filtering by Debt.type left out any credit card
  // without the optional overlay in Debts, which was most of them.
  const creditCardAccounts = accounts?.filter((a) => a.type === 'liability' && a.subtype === 'credit_card') ?? []
  const revolvingTotal = creditCardAccounts.reduce((sum, a) => sum + Number(a.balance), 0)
  const avgApr =
    creditCardAccounts.length > 0
      ? creditCardAccounts.reduce((sum, a) => sum + Number(a.interest_rate || 0), 0) / creditCardAccounts.length
      : 0

  const monthPct =
    budgetCurrent && Number(budgetCurrent.variable_total_budgeted) > 0
      ? Math.round((Number(budgetCurrent.variable_total_spent) / Number(budgetCurrent.variable_total_budgeted)) * 100)
      : 0

  // The "current" week is the one that contains today's date, not the last
  // one in the array -- budget/current/weekly returns ALL weeks of the
  // month (a calendar one can have 5), and the last one is usually a future
  // week with no expense yet, which used to always show 0%/$0 regardless
  // of actual spending.
  const todayIso = new Date().toISOString().slice(0, 10)
  const currentWeek = budgetWeekly?.weeks.find((w) => w.date_from <= todayIso && todayIso <= w.date_to)
  const currentWeekSpent = currentWeek
    ? Object.values(currentWeek.spent_by_category).reduce((acc, v) => acc + Number(v), 0)
    : 0
  const currentWeekBudget = currentWeek
    ? Object.values(currentWeek.weekly_limit_reference).reduce((acc, v) => acc + Number(v), 0)
    : 0
  const weekPct = currentWeekBudget > 0 ? Math.round((currentWeekSpent / currentWeekBudget) * 100) : 0

  // Ready monthly reports, sorted chronologically -- feed both the net
  // worth trend and the month vs previous month comparison.
  const monthlyReports = useMemo(
    () =>
      (reportsData?.items ?? [])
        .filter((r) => r.status === 'ready' && r.summary && r.type.startsWith('monthly'))
        .slice()
        .sort((a, b) => a.period_start.localeCompare(b.period_start)),
    [reportsData],
  )
  const netWorthValues = monthlyReports.map((r) => Number(r.summary!.net_worth.end))
  const netWorthLabels = monthlyReports.map((r) =>
    new Date(r.period_start).toLocaleDateString(activeDateLocale(), { month: 'short', timeZone: 'UTC' }),
  )
  const [prevMonthReport, currentMonthReport] = monthlyReports.slice(-2).length === 2
    ? monthlyReports.slice(-2)
    : [undefined, monthlyReports.at(-1)]
  // If the last generated report is for the CURRENT month (not over yet),
  // its total is a partial snapshot -- comparing it against a full previous
  // month looks like a false drop (e.g. 9 days of income vs 30 days of last
  // month, "dropped 97%" when the month hasn't even ended). In that case we
  // use the always-live summary for the value and don't show "vs mes
  // anterior" at all. (todayIso was already computed above for the
  // budget's current week, same value).
  const isCurrentReportClosed = currentMonthReport ? todayIso > currentMonthReport.period_end : false

  function pctChange(current: number, previous: number | undefined): number | null {
    if (previous === undefined || previous === 0) return null
    return ((current - previous) / previous) * 100
  }

  const monthIncome = isCurrentReportClosed
    ? Number(currentMonthReport?.summary?.income.total ?? 0)
    : Number(currentMonthSummary?.income.total ?? 0)
  const monthExpenses = isCurrentReportClosed
    ? Number(currentMonthReport?.summary?.expenses.total ?? 0)
    : Number(currentMonthSummary?.expenses.total ?? 0)
  const prevMonthIncome = prevMonthReport?.summary?.income.total
  const prevMonthExpenses = prevMonthReport?.summary?.expenses.total
  const incomeDelta = isCurrentReportClosed
    ? pctChange(monthIncome, prevMonthIncome !== undefined ? Number(prevMonthIncome) : undefined)
    : null
  const expensesDelta = isCurrentReportClosed
    ? pctChange(monthExpenses, prevMonthExpenses !== undefined ? Number(prevMonthExpenses) : undefined)
    : null

  // Active debts with progress: how much of the original amount has already
  // been paid off (owed_by_me) or collected (owed_to_me), without
  // distinguishing principal from interest.
  const activeDebts = (debts ?? [])
    .filter((d) => d.status === 'active')
    .map((d) => {
      const total = Number(d.total_amount)
      const balance = Number(d.current_balance)
      const pctPaid = total > 0 ? Math.max(0, Math.min(100, Math.round((1 - balance / total) * 100))) : 0
      return { ...d, pctPaid }
    })
    .sort((a, b) => b.pctPaid - a.pctPaid)

  const pctColor = (pct: number) =>
    pct >= 90 ? 'var(--nl-danger-ink)' : pct >= 70 ? 'var(--nl-warning-ink)' : 'var(--nl-accent-ink)'

  // Money going out only -- a recurring item_type='income' (e.g. payroll)
  // doesn't "come due", it gets received. This panel is for "upcoming
  // PAYMENTS", mixing income in here with the same due-date language
  // wouldn't make sense.
  const upcoming = [
    ...(recurring ?? [])
      .filter((item) => item.item_type !== 'income')
      .map((item) => ({
        key: `r-${item.id}`,
        name: item.name,
        amount: item.amount,
        due: item.next_date,
      })),
    ...(snapshot?.upcoming_7_days ?? [])
      .filter((p) => p.type === 'debt')
      .map((p) => ({ key: `d-${p.date}-${p.name}`, name: p.name, amount: p.amount, due: p.date })),
  ]
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, 6)

  const dueSoonItems = upcoming.filter((u) => {
    const days = (new Date(u.due).getTime() - Date.now()) / 86_400_000
    return days >= 0 && days <= 3
  })

  const today = new Date()
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today)
    d.setDate(d.getDate() - (6 - i))
    return d
  })
  const weeklyBars = weekDays.map((day) => {
    const iso = day.toISOString().slice(0, 10)
    const dayTx = (recentTx?.data ?? []).filter((tx) => tx.date === iso)
    const income = dayTx.filter((tx) => tx.entry_type === 'income').reduce((s, tx) => s + Number(tx.amount ?? 0), 0)
    const expense = dayTx
      .filter((tx) => tx.entry_type === 'expense')
      .reduce((s, tx) => s + Number(tx.amount ?? 0), 0)
    return { label: weekdayShort(t, day.getDay()), a: income, b: expense }
  })

  const topInsights = (insights ?? [])
    .slice()
    .sort((a, b) => (a.priority === 'high' ? -1 : 1) - (b.priority === 'high' ? -1 : 1))
    .slice(0, 2)

  return (
    <div>
      <ViewHeader
        icon={<Home />}
        title={t('dashboard.title')}
        help={<DashboardHelp />}
        section={HEADER_SECTIONS.diario}
        tourKey="dashboard"
        subtitle={
          user?.name
            ? t('dashboard.subtitleWithName', { greeting: greeting(t), name: user.name.split(' ')[0] })
            : t('dashboard.subtitle', { greeting: greeting(t) })
        }
        actions={
          <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Calendar size={14} className="flex-shrink-0" />
            {todayLabel()}
          </span>
        }
      />

      {dueSoonItems.length > 0 && (
        <div className="bg-card border border-border rounded-md p-3.5 mb-4" data-tour="dashboard:due-soon">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={15} className="text-muted-foreground flex-shrink-0" />
            <span className="text-[13px] font-medium">
              {t('dashboard.upcomingPaymentsCount', { count: dueSoonItems.length })}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {dueSoonItems.map((item) => (
              <span
                key={item.key}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px]"
                style={{ background: 'var(--nl-warning-soft-bg)', color: 'var(--nl-warning-ink)' }}
              >
                {item.name} · {formatMoney(item.amount)} · {item.due}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* The usual 4 cards + the 2 income/expense ones (if there's already a
          report for the month) go in ONE single row -- they used to be two
          blocks with their own margin between them, which added a full
          extra row of height. `compact` on StatCard strips their extra
          padding/size, this is the only place in the app that uses that
          variant. */}
      <div className="grid grid-cols-2 gap-2.5 mb-4 lg:flex lg:gap-3 lg:flex-wrap">
        <StatCard
          compact
          icon={<Droplet />}
          label={t('dashboard.stats.liquidity')}
          value={loadingSnapshot ? '—' : formatMoney(snapshot?.available_this_week.liquid_balance)}
          note={t('dashboard.stats.accountsCount', { count: liquidAccounts.length })}
          dataTour="dashboard:liquidity"
        />
        <StatCard
          compact
          icon={<CreditCardIcon />}
          label={t('dashboard.stats.revolvingDebt')}
          value={formatMoney(revolvingTotal)}
          valueClassName="text-[color:var(--nl-danger-ink)]"
          note={avgApr > 0 ? t('dashboard.stats.avgApr', { pct: (avgApr * 100).toFixed(1) }) : t('dashboard.stats.noActiveCards')}
        />
        <StatCard
          compact
          icon={<Grid2x2 />}
          label={t('dashboard.stats.monthBudget')}
          value={<span style={{ color: pctColor(monthPct) }}>{monthPct}%</span>}
          note={formatMoney(budgetCurrent?.variable_total_spent)}
          dataTour="dashboard:budget"
        />
        <StatCard
          compact
          icon={<Clock />}
          label={t('dashboard.stats.weekBudget')}
          value={<span style={{ color: pctColor(weekPct) }}>{weekPct}%</span>}
          note={formatMoney(currentWeekSpent)}
        />
        {currentMonthReport && (
          <>
            <StatCard
              compact
              icon={<TrendingUp />}
              label={t('dashboard.stats.monthIncome')}
              value={formatMoney(monthIncome)}
              note={<MonthDelta pct={incomeDelta} goodDirection="up" />}
              dataTour="dashboard:month-summary"
            />
            <StatCard
              compact
              icon={<TrendingDown />}
              label={t('dashboard.stats.monthExpenses')}
              value={formatMoney(monthExpenses)}
              note={<MonthDelta pct={expensesDelta} goodDirection="down" />}
            />
          </>
        )}
      </div>

      {/* A single regular 4-column grid -- each card always takes up 2 of 4
          (half), instead of each row having its own custom proportion
          (0.32fr, 0.65fr...) unrelated to one another. They're grouped by
          type: charts with charts, lists with lists, so each one's width
          feels intentional rather than arbitrary. */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-4 items-start">
        <div className="lg:col-span-2 bg-card border border-border rounded-md p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[15px] font-medium">{t('dashboard.recentTransactions.heading')}</span>
            <Link to="/transactions" className="text-xs text-muted-foreground hover:text-foreground">
              {t('dashboard.recentTransactions.viewAll')}
            </Link>
          </div>
          <div className="hidden lg:grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 text-[11px] uppercase tracking-wide text-muted-foreground pb-2">
            <span>{t('dashboard.recentTransactions.columns.name')}</span>
            <span className="text-right">{t('dashboard.recentTransactions.columns.amount')}</span>
            <span>{t('dashboard.recentTransactions.columns.category')}</span>
            <span>{t('dashboard.recentTransactions.columns.date')}</span>
          </div>
          {(recentTx?.data ?? []).slice(0, 6).map((tx) => (
            <div key={tx.id}>
              <div className="hidden lg:grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 items-center py-2 border-t border-border text-[13px]">
                <span className="truncate">{tx.description}</span>
                <span
                  className={`text-right ${isPositiveEntryType(tx.entry_type) ? 'text-[color:var(--nl-accent-ink)]' : ''}`}
                >
                  {formatMoney(tx.amount ?? 0)}
                </span>
                <span>
                  <CategoryBadge
                    name={tx.category_name ?? entryTypeLabel(tx.entry_type)}
                    color={tx.category_id ? categoryColorById.get(tx.category_id) : undefined}
                  />
                </span>
                <span className="text-muted-foreground">{tx.date}</span>
              </div>
              <div className="lg:hidden flex flex-col gap-1.5 py-2 border-t border-border text-[13px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{tx.description}</span>
                  <span
                    className={`flex-shrink-0 ${isPositiveEntryType(tx.entry_type) ? 'text-[color:var(--nl-accent-ink)]' : ''}`}
                  >
                    {formatMoney(tx.amount ?? 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <CategoryBadge
                    name={tx.category_name ?? entryTypeLabel(tx.entry_type)}
                    color={tx.category_id ? categoryColorById.get(tx.category_id) : undefined}
                  />
                  <span className="text-muted-foreground text-[12px] flex-shrink-0">{tx.date}</span>
                </div>
              </div>
            </div>
          ))}
          {(recentTx?.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground py-4">{t('dashboard.recentTransactions.empty')}</p>
          )}
        </div>

        <div className="lg:col-span-2 bg-card border border-border rounded-md p-4" data-tour="dashboard:upcoming">
          <div className="text-[15px] font-medium mb-2">{t('dashboard.upcomingPayments.heading')}</div>
          <div className="flex flex-col">
            {upcoming.map((bill) => (
              <div key={bill.key} className="flex items-center gap-2.5 py-2 border-t border-border first:border-0">
                <div
                  className="w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-medium flex-shrink-0"
                  style={{ background: 'var(--nl-bg-track)' }}
                >
                  {bill.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] truncate">{bill.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {t('dashboard.upcomingPayments.dueDate', { date: formatShortDate(bill.due) })}
                  </div>
                </div>
                <div className="text-[13px] font-medium">{formatMoney(bill.amount)}</div>
              </div>
            ))}
            {upcoming.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('dashboard.upcomingPayments.empty')}</p>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 bg-card border border-border rounded-md p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[15px] font-medium">{t('dashboard.accounts.heading')}</span>
            <Link to="/accounts" className="text-xs text-muted-foreground hover:text-foreground">
              {t('dashboard.accounts.viewAll')}
            </Link>
          </div>
          <div className="flex flex-col">
            {liquidAccounts.slice(0, 6).map((a) => (
              <div key={a.id} className="flex items-center gap-2.5 py-1.5 border-t border-border first:border-0">
                <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: a.color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] truncate">{a.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{accountSubtypeLabel(a.subtype)}</div>
                </div>
                <div className="text-[13px] font-medium">{formatMoney(a.balance)}</div>
              </div>
            ))}
            {liquidAccounts.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('dashboard.accounts.empty')}</p>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 bg-card border border-border rounded-md p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[15px] font-medium">{t('dashboard.activeDebts.heading')}</span>
            <Link to="/debts" className="text-xs text-muted-foreground hover:text-foreground">
              {t('dashboard.activeDebts.viewAll')}
            </Link>
          </div>
          <div className="flex flex-col">
            {activeDebts.slice(0, 4).map((d) => (
              <div key={d.id} className="py-2 border-t border-border first:border-0">
                <div className="flex items-center justify-between text-[13px] mb-1.5">
                  <span className="truncate">{d.name}</span>
                  <span className="text-muted-foreground flex-shrink-0 ml-2">{d.pctPaid}%</span>
                </div>
                <div
                  className="h-1.5 rounded-full overflow-hidden"
                  style={{ background: 'var(--nl-bg-track)' }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${d.pctPaid}%`,
                      background: d.direction === 'owed_to_me' ? 'var(--nl-accent)' : 'var(--nl-danger)',
                    }}
                  />
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  {t(
                    d.direction === 'owed_to_me'
                      ? 'dashboard.activeDebts.progressOwedToMe'
                      : 'dashboard.activeDebts.progressOwedByMe',
                    { balance: formatMoney(d.current_balance), total: formatMoney(d.total_amount) },
                  )}
                </div>
              </div>
            ))}
            {activeDebts.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('dashboard.activeDebts.empty')}</p>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 bg-card border border-border rounded-md p-4" data-tour="dashboard:cashflow">
          <div className="text-[15px] font-medium mb-1">{t('dashboard.cashflow.heading')}</div>
          <p className="text-xs text-muted-foreground mb-2">{t('dashboard.cashflow.subtitle')}</p>
          <GroupedBars groups={weeklyBars} height={110} />
          <Legend
            items={[
              { label: t('dashboard.cashflow.income'), color: 'var(--nl-accent)' },
              { label: t('dashboard.cashflow.expenses'), color: 'var(--nl-danger)' },
            ]}
          />
        </div>

        <div className="lg:col-span-2 bg-card border border-border rounded-md p-4" data-tour="dashboard:networth">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[15px] font-medium">{t('dashboard.netWorth.heading')}</span>
            <Link to="/reports" className="text-xs text-muted-foreground hover:text-foreground">
              {t('dashboard.netWorth.viewReports')}
            </Link>
          </div>
          <p className="text-xs text-muted-foreground mb-2">{t('dashboard.netWorth.subtitle')}</p>
          {netWorthValues.length >= 2 ? (
            <LineChart series={netWorthValues} xLabels={netWorthLabels} height={110} />
          ) : (
            <p className="text-sm text-muted-foreground py-6 text-center">{t('dashboard.netWorth.empty')}</p>
          )}
        </div>

        {topInsights.map((insight, i) => (
          <div
            key={insight.id}
            className="lg:col-span-2 bg-card border border-border rounded-md p-3.5"
            style={{ borderLeft: `3px solid ${insight.priority === 'high' ? 'var(--nl-danger)' : 'var(--nl-accent)'}` }}
            data-tour={i === 0 ? 'dashboard:insights-preview' : undefined}
          >
            <p className="text-[13px]">{insight.description}</p>
            <Link to="/insights" className="text-xs mt-2 inline-block" style={{ color: 'var(--nl-accent-ink)' }}>
              {insight.title} →
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}

function MonthDelta({ pct, goodDirection }: { pct: number | null; goodDirection: 'up' | 'down' }) {
  const { t } = useTranslation('pages')
  if (pct === null) {
    return <span className="text-muted-foreground">{t('dashboard.monthDelta.comparesAtMonthEnd')}</span>
  }
  const isUp = pct >= 0
  const isGood = goodDirection === 'up' ? isUp : !isUp
  const Icon = isUp ? TrendingUp : TrendingDown
  return (
    <span
      className="inline-flex items-center gap-1"
      style={{ color: isGood ? 'var(--nl-accent-ink)' : 'var(--nl-danger-ink)' }}
    >
      <Icon size={12} strokeWidth={2} />
      {t('dashboard.monthDelta.vsPreviousMonth', { pct: Math.abs(pct).toFixed(1) })}
    </span>
  )
}

function CreditCardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="9" x2="22" y2="9" />
    </svg>
  )
}
