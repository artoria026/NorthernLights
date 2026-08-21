import { AlertTriangle, Calendar, Droplet, Grid2x2, Home, Clock, TrendingDown, TrendingUp } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { GroupedBars, LineChart } from '@/lib/charts'
import { accountSubtypeLabel, entryTypeLabel, formatMoney as formatMoneyBase, formatShortDate, isPositiveEntryType } from '@/lib/utils'
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

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Buenos días'
  if (hour < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function todayLabel(): string {
  return capitalize(
    new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  )
}

const WEEKDAY = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

function DashboardHelp() {
  return (
    <>
      <HelpSection heading="Qué es esta pantalla">
        <p>
          Un resumen del estado general de tus finanzas: cuánto dinero líquido tienes, cuánto debes en
          tarjetas, qué tan cerca estás de tu límite de presupuesto y qué pagos se acercan.
        </p>
      </HelpSection>
      <HelpSection heading="Las tarjetas de arriba">
        <p>
          <strong>Liquidez</strong> suma el saldo de tus cuentas tipo efectivo/banco (no tarjetas de
          crédito). <strong>Deuda revolvente</strong> es lo que debes en tarjetas de crédito activas, con
          su TAE promedio. <strong>Presupuesto del mes</strong> y <strong>de la semana</strong> muestran
          qué porcentaje llevas gastado contra lo presupuestado — el color cambia de verde a naranja a
          rojo según qué tan cerca estás del límite. En cuanto generes el reporte del mes en curso
          (Reportes → Generar), aparecen dos tarjetas más: <strong>Ingresos del mes</strong> y{' '}
          <strong>Gastos del mes</strong>, cada una comparada contra el mes anterior.
        </p>
      </HelpSection>
      <HelpSection heading="Próximos pagos">
        <p>
          Junta tus gastos recurrentes activos (Netflix, renta, etc.) con los pagos de deudas que vencen
          en los próximos 7 días. Si algo vence en 3 días o menos, aparece como aviso arriba de las
          tarjetas.
        </p>
      </HelpSection>
      <HelpSection heading="Patrimonio neto y deudas activas">
        <p>
          La línea de patrimonio neto usa tus reportes mensuales generados (Reportes → Generar); si un mes
          no tiene reporte, no aparece un punto para él. El progreso de cada deuda compara el saldo actual
          contra el monto original — no distingue capital de intereses, es una referencia visual rápida.
        </p>
      </HelpSection>
      <HelpTip>
        Esta pantalla es de solo lectura — para registrar movimientos usa Transacciones, y para ver el
        detalle de cada rubro entra a su página específica (los enlaces "Ver todas →" te llevan directo).
      </HelpTip>
    </>
  )
}

export function Dashboard() {
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
  // Deuda revolvente viene de Account, no de Debt: una TDC es una cuenta
  // completa por si sola (ver rediseno que saco tarjetas de credito del
  // modelo de Deudas) -- filtrar por Debt.type dejaba fuera cualquier TDC
  // sin overlay opcional en Deudas, que era la mayoria.
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

  // La semana "actual" es la que contiene la fecha de hoy, no la ultima del
  // arreglo -- budget/current/weekly devuelve TODAS las semanas del mes (una
  // de calendario puede tener 5), y la ultima suele ser una semana futura sin
  // gasto todavia, lo que antes mostraba siempre 0%/$0 sin importar el gasto real.
  const todayIso = new Date().toISOString().slice(0, 10)
  const currentWeek = budgetWeekly?.weeks.find((w) => w.date_from <= todayIso && todayIso <= w.date_to)
  const currentWeekSpent = currentWeek
    ? Object.values(currentWeek.spent_by_category).reduce((acc, v) => acc + Number(v), 0)
    : 0
  const currentWeekBudget = currentWeek
    ? Object.values(currentWeek.weekly_limit_reference).reduce((acc, v) => acc + Number(v), 0)
    : 0
  const weekPct = currentWeekBudget > 0 ? Math.round((currentWeekSpent / currentWeekBudget) * 100) : 0

  // Reportes mensuales listos, ordenados cronologicamente -- alimentan tanto
  // la tendencia de patrimonio neto como la comparacion mes vs mes anterior.
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
    new Date(r.period_start).toLocaleDateString('es-MX', { month: 'short', timeZone: 'UTC' }),
  )
  const [prevMonthReport, currentMonthReport] = monthlyReports.slice(-2).length === 2
    ? monthlyReports.slice(-2)
    : [undefined, monthlyReports.at(-1)]
  // Si el ultimo reporte generado es del mes EN CURSO (todavia no termina),
  // su total es una foto parcial -- compararlo contra un mes anterior
  // completo se ve como una caida falsa (ej. 9 dias de ingreso vs 30 dias
  // del mes pasado, "cayo 97%" cuando en realidad el mes ni termina). En
  // ese caso usamos el resumen siempre-vivo para el valor y no mostramos
  // "vs mes anterior" en absoluto. (todayIso ya se calculo arriba para la
  // semana actual del presupuesto, mismo valor).
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

  // Deudas activas con progreso: cuanto del monto original ya se liquido
  // (owed_by_me) o se cobro (owed_to_me), sin distinguir capital/intereses.
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

  // Solo salidas de dinero -- un recurrente item_type='income' (ej. nomina)
  // no "vence", se recibe. Este panel es de "proximos PAGOS", mezclar
  // ingresos aqui con el mismo lenguaje de vencimiento no tiene sentido.
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
    return { label: WEEKDAY[day.getDay()], a: income, b: expense }
  })

  const topInsights = (insights ?? [])
    .slice()
    .sort((a, b) => (a.priority === 'high' ? -1 : 1) - (b.priority === 'high' ? -1 : 1))
    .slice(0, 2)

  return (
    <div>
      <ViewHeader
        icon={<Home />}
        title="Inicio"
        help={<DashboardHelp />}
        section={HEADER_SECTIONS.diario}
        tourKey="dashboard"
        subtitle={
          <>
            {greeting()}
            {user?.name ? `, ${user.name.split(' ')[0]}` : ''} — aquí tienes el resumen de tus finanzas.
          </>
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
              {dueSoonItems.length} pago{dueSoonItems.length === 1 ? '' : 's'} en los próximos 3 días
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

      {/* Las 4 tarjetas de siempre + las 2 de ingresos/gastos (si ya hay
          reporte del mes) van en UNA sola fila -- antes eran dos bloques con
          su propio margen entre si, lo que sumaba una fila completa de alto
          de mas. `compact` en StatCard les quita padding/tamano de sobra,
          esto es lo unico que usa esa variante en toda la app. */}
      <div className="grid grid-cols-2 gap-2.5 mb-4 lg:flex lg:gap-3 lg:flex-wrap">
        <StatCard
          compact
          icon={<Droplet />}
          label="Liquidez"
          value={loadingSnapshot ? '—' : formatMoney(snapshot?.available_this_week.liquid_balance)}
          note={`${liquidAccounts.length} cuenta${liquidAccounts.length === 1 ? '' : 's'}`}
          dataTour="dashboard:liquidity"
        />
        <StatCard
          compact
          icon={<CreditCardIcon />}
          label="Deuda revolvente"
          value={formatMoney(revolvingTotal)}
          valueClassName="text-[color:var(--nl-danger-ink)]"
          note={avgApr > 0 ? `TAE promedio ${(avgApr * 100).toFixed(1)}%` : 'Sin TDC activas'}
        />
        <StatCard
          compact
          icon={<Grid2x2 />}
          label="Presupuesto del mes"
          value={<span style={{ color: pctColor(monthPct) }}>{monthPct}%</span>}
          note={formatMoney(budgetCurrent?.variable_total_spent)}
          dataTour="dashboard:budget"
        />
        <StatCard
          compact
          icon={<Clock />}
          label="Presupuesto de la semana"
          value={<span style={{ color: pctColor(weekPct) }}>{weekPct}%</span>}
          note={formatMoney(currentWeekSpent)}
        />
        {currentMonthReport && (
          <>
            <StatCard
              compact
              icon={<TrendingUp />}
              label="Ingresos del mes"
              value={formatMoney(monthIncome)}
              note={<MonthDelta pct={incomeDelta} goodDirection="up" />}
              dataTour="dashboard:month-summary"
            />
            <StatCard
              compact
              icon={<TrendingDown />}
              label="Gastos del mes"
              value={formatMoney(monthExpenses)}
              note={<MonthDelta pct={expensesDelta} goodDirection="down" />}
            />
          </>
        )}
      </div>

      {/* Una sola cuadricula regular de 4 columnas -- cada tarjeta ocupa
          siempre 2 de 4 (mitad), en vez de que cada fila tuviera su propia
          proporcion custom (0.32fr, 0.65fr...) sin relacion entre si. Se
          agrupan por tipo: graficas con graficas, listas con listas, para
          que el ancho de cada una se sienta a proposito y no arbitrario. */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-4 items-start">
        <div className="lg:col-span-2 bg-card border border-border rounded-md p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[15px] font-medium">Transacciones recientes</span>
            <Link to="/transactions" className="text-xs text-muted-foreground hover:text-foreground">
              Ver todas las transacciones →
            </Link>
          </div>
          <div className="hidden lg:grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 text-[11px] uppercase tracking-wide text-muted-foreground pb-2">
            <span>Nombre</span>
            <span className="text-right">Monto</span>
            <span>Categoría</span>
            <span>Fecha</span>
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
            <p className="text-sm text-muted-foreground py-4">Aún no hay transacciones.</p>
          )}
        </div>

        <div className="lg:col-span-2 bg-card border border-border rounded-md p-4" data-tour="dashboard:upcoming">
          <div className="text-[15px] font-medium mb-2">Próximos pagos</div>
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
                  <div className="text-[11px] text-muted-foreground">Vence {formatShortDate(bill.due)}</div>
                </div>
                <div className="text-[13px] font-medium">{formatMoney(bill.amount)}</div>
              </div>
            ))}
            {upcoming.length === 0 && <p className="text-sm text-muted-foreground">No hay pagos próximos.</p>}
          </div>
        </div>

        <div className="lg:col-span-2 bg-card border border-border rounded-md p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[15px] font-medium">Cuentas</span>
            <Link to="/accounts" className="text-xs text-muted-foreground hover:text-foreground">
              Ver todas →
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
            {liquidAccounts.length === 0 && <p className="text-sm text-muted-foreground">Sin cuentas.</p>}
          </div>
        </div>

        <div className="lg:col-span-2 bg-card border border-border rounded-md p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[15px] font-medium">Deudas activas</span>
            <Link to="/debts" className="text-xs text-muted-foreground hover:text-foreground">
              Ver todas →
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
                  {formatMoney(d.current_balance)} {d.direction === 'owed_to_me' ? 'por cobrar' : 'pendiente'} de{' '}
                  {formatMoney(d.total_amount)}
                </div>
              </div>
            ))}
            {activeDebts.length === 0 && <p className="text-sm text-muted-foreground">Sin deudas activas.</p>}
          </div>
        </div>

        <div className="lg:col-span-2 bg-card border border-border rounded-md p-4" data-tour="dashboard:cashflow">
          <div className="text-[15px] font-medium mb-1">Flujo de caja de la semana</div>
          <p className="text-xs text-muted-foreground mb-2">Ingresos vs. gastos, últimos 7 días</p>
          <GroupedBars groups={weeklyBars} height={110} />
          <Legend
            items={[
              { label: 'Ingresos', color: 'var(--nl-accent)' },
              { label: 'Gastos', color: 'var(--nl-danger)' },
            ]}
          />
        </div>

        <div className="lg:col-span-2 bg-card border border-border rounded-md p-4" data-tour="dashboard:networth">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[15px] font-medium">Patrimonio neto</span>
            <Link to="/reports" className="text-xs text-muted-foreground hover:text-foreground">
              Ver reportes →
            </Link>
          </div>
          <p className="text-xs text-muted-foreground mb-2">Al cierre de cada mes con reporte generado</p>
          {netWorthValues.length >= 2 ? (
            <LineChart series={netWorthValues} xLabels={netWorthLabels} height={110} />
          ) : (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Genera reportes de al menos 2 meses (en Reportes) para ver la tendencia aquí.
            </p>
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
  if (pct === null) {
    return <span className="text-muted-foreground">Se compara al cerrar el mes</span>
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
      {Math.abs(pct).toFixed(1)}% vs mes anterior
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
