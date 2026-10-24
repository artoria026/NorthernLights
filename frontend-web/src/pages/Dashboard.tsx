import { AlertTriangle, Calendar, Droplet, Grid2x2, HandCoins, Home, Scale, Wallet } from 'lucide-react'
import { type ReactNode, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
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
  localIsoDate,
} from '@/lib/utils'
import { HelpSection, HelpTip } from '@/components/nl/Help'
import { RegisterChargeButton } from '@/components/nl/RegisterChargeButton'
import { SubscriptionIcon } from '@/components/nl/SubscriptionIcon'
import { TagsOverviewCard } from '@/components/nl/TagsOverviewCard'
import { CategoryBadge, HEADER_SECTIONS, Legend, StatCard, ViewHeader } from '@/components/nl/primitives'
import { useAccountSummary, useAccounts } from '@/hooks/useAccounts'
import { useBudgetCurrent, useBudgetWeekly } from '@/hooks/useBudget'
import { useCategories } from '@/hooks/useCategories'
import { useDebtSummary, useDebts } from '@/hooks/useDebts'
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
        <p>{t('dashboard.help.cardsAbove.body')}</p>
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

// Recent-transactions table (lg+): name | amount | category | date. Amount and date are
// fixed so the amount never moves; name and category are the ones that give way.
const RECENT_TX_COLUMNS = 'lg:grid-cols-[minmax(0,2fr)_7rem_minmax(0,1.2fr)_5.5rem]'

export function Dashboard() {
  const { t } = useTranslation('pages')
  const user = useAuthStore((s) => s.user)
  const { data: snapshot, isLoading: loadingSnapshot } = useFinancialSnapshot()
  const { data: accounts } = useAccounts()
  const { data: accountSummary } = useAccountSummary()
  const { data: debts } = useDebts()
  const { data: debtSummary } = useDebtSummary()
  const { data: budgetCurrent } = useBudgetCurrent()
  const { data: budgetWeekly } = useBudgetWeekly()
  const { data: recentTx } = useTransactions({ per_page: 30 })
  const { data: recurring } = useRecurringItems({ status: 'active' })
  const { data: insights } = useInsights()
  const { data: reportsData } = useReports(1, 12)
  const { data: currentMonthSummary } = useCurrentMonthSummary()
  const { data: categories } = useCategories()
  const categoryColorById = new Map((categories ?? []).map((c) => [c.id, c.color]))
  const categoryColorByName = new Map((categories ?? []).map((c) => [c.name, c.color]))

  const todayIso = localIsoDate(new Date())
  // Two weeks of movements (not "the latest N"): the cash-flow bars and their comparison
  // with the previous 7 days need every day of both weeks, however many entries they hold.
  const { data: twoWeeksTx } = useTransactions({ per_page: 500, date_from: localIsoDate(daysAgo(13)) })

  const liquidAccounts = accounts?.filter((a) => a.type === 'asset') ?? []
  // Revolving debt comes from Account, not Debt: a credit card is a full
  // account on its own (see the redesign that took credit cards out of the
  // Debts model) -- filtering by Debt.type left out any credit card
  // without the optional overlay in Debts, which was most of them.
  const creditCardAccounts = accounts?.filter((a) => a.type === 'liability' && a.subtype === 'credit_card') ?? []
  const revolvingTotal = creditCardAccounts.reduce((sum, a) => sum + Number(a.balance), 0)

  const liquidity = Number(snapshot?.available_this_week.liquid_balance ?? 0)
  // A paused debt is still owed (it counts in the totals and in Position) but asks for
  // nothing: only the active ones feed the upcoming payments.
  const openDebts = (debts ?? []).filter((d) => d.status !== 'completed')
  const owedByMeDebts = openDebts.filter((d) => d.direction !== 'owed_to_me')
  const owedToMeDebts = openDebts.filter((d) => d.direction === 'owed_to_me')
  const owedByMe = Number(debtSummary?.total_owed_by_me ?? 0) + revolvingTotal
  const owedToMe = Number(debtSummary?.total_owed_to_me ?? 0)
  // The same number Accounts shows: the backend's own net worth (real accounts plus what is owed
  // to and by the user). Until it loads, the pieces on screen give the same figure.
  const netWorth = accountSummary ? Number(accountSummary.net_worth) : liquidity + owedToMe - owedByMe

  // A budget at 0% used to mean two different things: "nothing spent" and "no budget set up".
  const monthBudgeted = Number(budgetCurrent?.variable_total_budgeted ?? 0)
  const monthSpent = Number(budgetCurrent?.variable_total_spent ?? 0)
  const monthPct = monthBudgeted > 0 ? Math.round((monthSpent / monthBudgeted) * 100) : 0

  // The "current" week is the one that contains today's date, not the last
  // one in the array -- budget/current/weekly returns ALL weeks of the
  // month (a calendar one can have 5), and the last one is usually a future
  // week with no expense yet, which used to always show 0%/$0 regardless
  // of actual spending.
  const currentWeek = budgetWeekly?.weeks.find((w) => w.date_from <= todayIso && todayIso <= w.date_to)
  const currentWeekSpent = currentWeek
    ? Object.values(currentWeek.spent_by_category).reduce((acc, v) => acc + Number(v), 0)
    : 0
  const currentWeekBudget = currentWeek
    ? Object.values(currentWeek.weekly_limit_reference).reduce((acc, v) => acc + Number(v), 0)
    : 0
  const weekPct = currentWeekBudget > 0 ? Math.round((currentWeekSpent / currentWeekBudget) * 100) : 0

  // Ready monthly reports, sorted chronologically -- they feed the net worth trend.
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

  // Always the live summary of the month in progress: it needs no generated report.
  const monthIncome = Number(currentMonthSummary?.income.total ?? 0)
  const monthExpenses = Number(currentMonthSummary?.expenses.total ?? 0)
  const monthNet = monthIncome - monthExpenses
  const topCategories = (currentMonthSummary?.expenses.by_category ?? [])
    .map((c) => ({ name: c.category, amount: Number(c.amount) }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)

  const pctColor = (pct: number) =>
    pct >= 90 ? 'var(--nl-danger-ink)' : pct >= 70 ? 'var(--nl-warning-ink)' : 'var(--nl-accent-ink)'

  // Money going out only -- a recurring item_type='income' (e.g. payroll)
  // doesn't "come due", it gets received. This panel is for "upcoming
  // PAYMENTS", mixing income in here with the same due-date language
  // wouldn't make sense. Debts come from their own next payment date (any of the
  // next 30 days), not just the week the snapshot looks at.
  const in30Days = localIsoDate(daysAgo(-30))
  const in3Days = localIsoDate(daysAgo(-3))
  const upcomingAll = [
    ...(recurring ?? [])
      .filter((item) => item.item_type !== 'income')
      .map((item) => ({
        key: `r-${item.id}`,
        id: item.id,
        name: item.name,
        amount: item.amount,
        due: item.next_date,
        icon: item.icon,
        // The app does not generate this item's charges: the user registers each one by hand.
        manual: !item.auto_generate,
      })),
    ...owedByMeDebts
      .filter((d) => d.status === 'active' && d.next_payment_date && d.payment_amount)
      .map((d) => ({
        key: `d-${d.id}`,
        id: d.id,
        name: d.name,
        amount: d.payment_amount as string,
        due: d.next_payment_date as string,
        icon: null,
        manual: false,
      })),
  ].sort((a, b) => a.due.localeCompare(b.due))
  const upcoming = upcomingAll.slice(0, 6)
  const upcoming30Total = upcomingAll
    .filter((u) => u.due <= in30Days)
    .reduce((sum, u) => sum + Number(u.amount), 0)

  // Compared as calendar dates: an item due TODAY is "in the next 3 days", and a charge the user
  // follows by hand whose date has passed is one they have not registered yet.
  const dueSoonItems = upcoming.filter((u) => u.due >= todayIso && u.due <= in3Days)
  const unregisteredItems = upcomingAll.filter((u) => u.manual && u.due < todayIso)

  const weekTx = twoWeeksTx?.data ?? []
  const sumOf = (type: string, from: string, to: string) =>
    weekTx
      .filter((tx) => tx.entry_type === type && tx.date >= from && tx.date <= to)
      .reduce((s, tx) => s + Number(tx.amount ?? 0), 0)
  const weekDays = Array.from({ length: 7 }, (_, i) => daysAgo(6 - i))
  const weeklyBars = weekDays.map((day) => {
    const iso = localIsoDate(day)
    return { label: weekdayShort(t, day.getDay()), a: sumOf('income', iso, iso), b: sumOf('expense', iso, iso) }
  })
  const weekExpenses = weeklyBars.reduce((s, d) => s + d.b, 0)
  const prevWeekExpenses = sumOf('expense', localIsoDate(daysAgo(13)), localIsoDate(daysAgo(7)))
  const weekChangePct = prevWeekExpenses > 0 ? ((weekExpenses - prevWeekExpenses) / prevWeekExpenses) * 100 : null

  // A balance adjustment is the app correcting a number, not something that happened:
  // it would only crowd out the movements the user cares about.
  const recentList = (recentTx?.data ?? []).filter((tx) => !tx.entry_type.startsWith('adjustment')).slice(0, 6)

  const topInsights = (insights ?? [])
    .slice()
    .sort((a, b) => (a.priority === 'high' ? -1 : 1) - (b.priority === 'high' ? -1 : 1))
    .slice(0, 2)

  const cardClass = 'bg-card border border-border rounded-md p-4'

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

      {(unregisteredItems.length > 0 || dueSoonItems.length > 0) && (
        <div className="bg-card border border-border rounded-md p-3.5 mb-4" data-tour="dashboard:due-soon">
          {unregisteredItems.length > 0 && (
            <div className={dueSoonItems.length > 0 ? 'mb-3' : ''}>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={15} className="flex-shrink-0" style={{ color: 'var(--nl-danger-ink)' }} />
                <span className="text-[13px] font-medium">
                  {t('recurring.registerCharge.pendingBanner', { count: unregisteredItems.length })}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {unregisteredItems.map((item) => (
                  <span
                    key={item.key}
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px]"
                    style={{ background: 'var(--nl-danger-soft-bg)', color: 'var(--nl-danger-ink)' }}
                  >
                    {item.name} · {formatMoney(item.amount)} · {item.due}
                  </span>
                ))}
              </div>
            </div>
          )}
          {dueSoonItems.length > 0 && (
            <div>
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
        </div>
      )}

      {/* Five answers, always the same ones: what I have, how the month is going, what I owe,
          what I am owed, and whether I am within budget. `compact` strips the cards' extra
          padding; this is the only place in the app that uses that variant. */}
      <div className="grid grid-cols-2 gap-2.5 mb-4 lg:flex lg:gap-3 lg:flex-wrap">
        <StatCard
          compact
          icon={<Droplet />}
          tone="blue"
          label={t('dashboard.stats.liquidity')}
          value={loadingSnapshot ? '—' : formatMoney(liquidity)}
          note={t('dashboard.stats.accountsCount', { count: liquidAccounts.length })}
          dataTour="dashboard:liquidity"
        />
        <StatCard
          compact
          icon={<Scale />}
          tone={monthNet < 0 ? 'danger' : 'accent'}
          label={t('dashboard.stats.monthNet')}
          value={formatMoney(monthNet)}
          valueClassName={monthNet < 0 ? 'text-[color:var(--nl-danger-ink)]' : undefined}
          note={t('dashboard.stats.monthNetNote', { income: formatMoney(monthIncome), expenses: formatMoney(monthExpenses) })}
          dataTour="dashboard:month-summary"
        />
        <StatCard
          compact
          icon={<Wallet />}
          tone={owedByMe > 0 ? 'danger' : 'accent'}
          label={t('dashboard.stats.owe')}
          value={formatMoney(owedByMe)}
          valueClassName={owedByMe > 0 ? 'text-[color:var(--nl-danger-ink)]' : undefined}
          note={t('dashboard.stats.oweNote', { count: owedByMeDebts.length + creditCardAccounts.length })}
        />
        <StatCard
          compact
          icon={<HandCoins />}
          tone="accent"
          label={t('dashboard.stats.owedToMe')}
          value={formatMoney(owedToMe)}
          note={t('dashboard.stats.owedToMeNote', { count: owedToMeDebts.length })}
        />
        <StatCard
          compact
          icon={<Grid2x2 />}
          tone={monthBudgeted <= 0 ? 'violet' : monthPct >= 90 ? 'danger' : monthPct >= 70 ? 'warning' : 'accent'}
          label={t('dashboard.stats.monthBudget')}
          value={
            monthBudgeted > 0 ? <span style={{ color: pctColor(monthPct) }}>{monthPct}%</span> : '—'
          }
          note={
            monthBudgeted > 0
              ? t('dashboard.stats.budgetNote', {
                  spent: formatMoney(monthSpent),
                  week: currentWeekBudget > 0 ? ` · ${t('dashboard.stats.budgetWeek', { pct: weekPct })}` : '',
                })
              : (
                  <Link to="/budget" className="hover:text-foreground underline-offset-2 hover:underline">
                    {t('dashboard.stats.noBudget')}
                  </Link>
                )
          }
          dataTour="dashboard:budget"
        />
      </div>

      {/* Two independent columns instead of one grid of rows: a short card no longer leaves a
          hole next to a tall one, each column just keeps stacking. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4 items-start">
        <div className="flex flex-col gap-4 min-w-0">
          <div className={cardClass}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[15px] font-medium">{t('dashboard.recentTransactions.heading')}</span>
              <Link to="/transactions" className="text-xs text-muted-foreground hover:text-foreground">
                {t('dashboard.recentTransactions.viewAll')}
              </Link>
            </div>
            {/* Same column template in the header and in every row (each row is its own
                grid): amount and date have a fixed width, and name/category use
                minmax(0, ...) so a long text is cut instead of widening its track --
                a plain `fr` track can't be narrower than its content, which is what used
                to shove the amount out of line. */}
            <div className={`hidden lg:grid ${RECENT_TX_COLUMNS} gap-2 text-[11px] uppercase tracking-wide text-muted-foreground pb-2`}>
              <span>{t('dashboard.recentTransactions.columns.name')}</span>
              <span className="text-right">{t('dashboard.recentTransactions.columns.amount')}</span>
              <span>{t('dashboard.recentTransactions.columns.category')}</span>
              <span>{t('dashboard.recentTransactions.columns.date')}</span>
            </div>
            {recentList.map((tx) => (
              <div key={tx.id}>
                <div className={`hidden lg:grid ${RECENT_TX_COLUMNS} gap-2 items-center py-2 border-t border-border text-[13px]`}>
                  <span className="truncate" title={tx.description}>{tx.description}</span>
                  <span
                    className={`text-right whitespace-nowrap ${isPositiveEntryType(tx.entry_type) ? 'text-[color:var(--nl-accent-ink)]' : ''}`}
                  >
                    {formatMoney(tx.amount ?? 0)}
                  </span>
                  <span className="min-w-0">
                    <CategoryBadge
                      name={tx.category_name ?? entryTypeLabel(tx.entry_type)}
                      color={tx.category_id ? categoryColorById.get(tx.category_id) : undefined}
                    />
                  </span>
                  <span className="text-muted-foreground whitespace-nowrap">{tx.date}</span>
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
            {recentList.length === 0 && (
              <p className="text-sm text-muted-foreground py-4">{t('dashboard.recentTransactions.empty')}</p>
            )}
          </div>

          <div className={cardClass} data-tour="dashboard:categories">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[15px] font-medium">{t('dashboard.monthCategories.heading')}</span>
              <Link to="/reports" className="text-xs text-muted-foreground hover:text-foreground">
                {t('dashboard.monthCategories.viewReports')}
              </Link>
            </div>
            {topCategories.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('dashboard.monthCategories.empty')}</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {topCategories.map((c) => {
                  const share = monthExpenses > 0 ? (c.amount / monthExpenses) * 100 : 0
                  return (
                    <div key={c.name}>
                      <div className="flex items-center justify-between gap-3 text-[13px] mb-1">
                        <span className="truncate">{c.name}</span>
                        <span className="flex-shrink-0">
                          {formatMoney(c.amount)}{' '}
                          <span className="text-[11px] text-muted-foreground">{Math.round(share)}%</span>
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--nl-bg-track)' }}>
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${share}%`, background: categoryColorByName.get(c.name) ?? 'var(--nl-accent)' }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className={cardClass} data-tour="dashboard:cashflow">
            <div className="text-[15px] font-medium mb-1">{t('dashboard.cashflow.heading')}</div>
            <p className="text-xs text-muted-foreground mb-2">
              {t('dashboard.cashflow.weekTotal', { amount: formatMoney(weekExpenses) })}
              {weekChangePct !== null &&
                ` · ${t(weekChangePct >= 0 ? 'dashboard.cashflow.weekUp' : 'dashboard.cashflow.weekDown', {
                  pct: Math.abs(weekChangePct).toFixed(0),
                })}`}
            </p>
            <GroupedBars groups={weeklyBars} height={110} />
            <Legend
              items={[
                { label: t('dashboard.cashflow.income'), color: 'var(--nl-accent)' },
                { label: t('dashboard.cashflow.expenses'), color: 'var(--nl-danger)' },
              ]}
            />
          </div>

          {topInsights.map((insight, i) => (
            <div
              key={insight.id}
              className="bg-card border border-border rounded-md p-3.5"
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

        <div className="flex flex-col gap-4 min-w-0">
          <div className={cardClass} data-tour="dashboard:upcoming">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[15px] font-medium">{t('dashboard.upcomingPayments.heading')}</span>
              {upcoming30Total > 0 && (
                <span className="text-xs text-muted-foreground">
                  {t('dashboard.upcomingPayments.total30', { amount: formatMoney(upcoming30Total) })}
                </span>
              )}
            </div>
            <div className="flex flex-col">
              {upcoming.map((bill) => (
                <div key={bill.key} className="flex items-center gap-2.5 py-2 border-t border-border first:border-0">
                  <SubscriptionIcon icon={bill.icon} name={bill.name} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] truncate">{bill.name}</div>
                    <div
                      className="text-[11px] text-muted-foreground"
                      style={bill.manual && bill.due < todayIso ? { color: 'var(--nl-danger-ink)' } : undefined}
                    >
                      {t(
                        bill.manual && bill.due < todayIso
                          ? 'dashboard.upcomingPayments.overdueDate'
                          : 'dashboard.upcomingPayments.dueDate',
                        { date: formatShortDate(bill.due) },
                      )}
                    </div>
                  </div>
                  {bill.manual && bill.due <= in3Days && (
                    <RegisterChargeButton item={bill} highlight={bill.due <= todayIso} />
                  )}
                  <div className="text-[13px] font-medium">{formatMoney(bill.amount)}</div>
                </div>
              ))}
              {upcoming.length === 0 && (
                <p className="text-sm text-muted-foreground">{t('dashboard.upcomingPayments.empty')}</p>
              )}
            </div>
          </div>

          {/* Accounts and debts together: what I have, what I owe, what I am owed, and what
              that adds up to. Replaces two separate cards of very different heights. */}
          <div className={cardClass} data-tour="dashboard:networth">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <div className="text-[15px] font-medium">{t('dashboard.position.heading')}</div>
                <div className="text-xs text-muted-foreground">{t('dashboard.position.netWorth')}</div>
              </div>
              <div
                className="text-[22px] font-light"
                style={netWorth < 0 ? { color: 'var(--nl-danger-ink)' } : undefined}
              >
                {formatMoney(netWorth)}
              </div>
            </div>

            <PositionSection
              title={t('dashboard.position.accounts')}
              total={formatMoney(liquidity)}
              link={{ to: '/accounts', label: t('dashboard.accounts.viewAll') }}
            >
              {liquidAccounts.slice(0, 6).map((a) => (
                <div key={a.id} className="flex items-center gap-2.5 py-1.5">
                  <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: a.color }} />
                  <div className="flex-1 min-w-0 text-[13px] truncate">
                    {a.name}
                    <span className="text-[11px] text-muted-foreground"> · {accountSubtypeLabel(a.subtype)}</span>
                  </div>
                  <div className="text-[13px] font-medium">{formatMoney(a.balance)}</div>
                </div>
              ))}
              {liquidAccounts.length === 0 && (
                <p className="text-sm text-muted-foreground">{t('dashboard.accounts.empty')}</p>
              )}
            </PositionSection>

            <PositionSection
              title={t('dashboard.position.owe')}
              total={formatMoney(owedByMe)}
              link={{ to: '/debts', label: t('dashboard.activeDebts.viewAll') }}
            >
              {creditCardAccounts.map((a) => (
                <DebtRow
                  key={a.id}
                  name={a.name}
                  amount={formatMoney(a.balance)}
                  hint={t('dashboard.position.card')}
                />
              ))}
              {owedByMeDebts
                .slice()
                .sort((a, b) => Number(b.current_balance) - Number(a.current_balance))
                .slice(0, 3)
                .map((d) => (
                  <DebtRow
                    key={d.id}
                    name={d.name}
                    amount={formatMoney(d.current_balance)}
                    pctPaid={paidPct(d)}
                    color="var(--nl-danger)"
                    hint={d.status === 'paused' ? t('dashboard.position.paused') : undefined}
                  />
                ))}
              {owedByMeDebts.length === 0 && creditCardAccounts.length === 0 && (
                <p className="text-sm text-muted-foreground">{t('dashboard.activeDebts.empty')}</p>
              )}
            </PositionSection>

            <PositionSection title={t('dashboard.position.owedToMe')} total={formatMoney(owedToMe)}>
              {owedToMeDebts
                .slice()
                .sort((a, b) => Number(b.current_balance) - Number(a.current_balance))
                .slice(0, 3)
                .map((d) => (
                  <DebtRow
                    key={d.id}
                    name={d.name}
                    amount={formatMoney(d.current_balance)}
                    pctPaid={paidPct(d)}
                    color="var(--nl-accent)"
                    hint={d.status === 'paused' ? t('dashboard.position.paused') : undefined}
                  />
                ))}
              {owedToMeDebts.length === 0 && (
                <p className="text-sm text-muted-foreground">{t('dashboard.position.nobodyOwesMe')}</p>
              )}
            </PositionSection>

            {netWorthValues.length >= 2 && (
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground mb-1">{t('dashboard.netWorth.subtitle')}</p>
                <LineChart series={netWorthValues} xLabels={netWorthLabels} height={90} />
              </div>
            )}
          </div>

          <TagsOverviewCard />

        </div>
      </div>
    </div>
  )
}

function daysAgo(days: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d
}

/** How much of what was lent/borrowed has already been paid back or collected (principal and
 * interest are not told apart: a quick visual reference). */
function paidPct(debt: { total_amount: string; current_balance: string }): number {
  const total = Number(debt.total_amount)
  return total > 0 ? Math.max(0, Math.min(100, Math.round((1 - Number(debt.current_balance) / total) * 100))) : 0
}

function PositionSection({
  title,
  total,
  link,
  children,
}: {
  title: string
  total: string
  link?: { to: string; label: string }
  children: ReactNode
}) {
  return (
    <div className="py-2 border-t border-border">
      <div className="flex items-center justify-between gap-3 mb-1">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{title}</span>
        <span className="flex items-center gap-3">
          {link && (
            <Link to={link.to} className="text-xs text-muted-foreground hover:text-foreground">
              {link.label}
            </Link>
          )}
          <span className="text-[13px] font-medium">{total}</span>
        </span>
      </div>
      {children}
    </div>
  )
}

function DebtRow({
  name,
  amount,
  pctPaid,
  color,
  hint,
}: {
  name: string
  amount: string
  pctPaid?: number
  color?: string
  hint?: string
}) {
  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="truncate">
          {name}
          {hint && <span className="text-[11px] text-muted-foreground"> · {hint}</span>}
        </span>
        <span className="flex-shrink-0">
          {amount}
          {pctPaid !== undefined && <span className="text-[11px] text-muted-foreground"> · {pctPaid}%</span>}
        </span>
      </div>
      {pctPaid !== undefined && (
        <div className="h-1 rounded-full overflow-hidden mt-1" style={{ background: 'var(--nl-bg-track)' }}>
          <div className="h-full rounded-full" style={{ width: `${pctPaid}%`, background: color }} />
        </div>
      )}
    </div>
  )
}
