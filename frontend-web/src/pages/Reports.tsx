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
import { formatMoney as formatMoneyBase } from '@/lib/utils'
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
  // timeZone: 'UTC' -- `period_start` es "YYYY-MM-DD" (fecha sin hora), que
  // Date() parsea como medianoche UTC; formatear en la zona local del
  // navegador puede correr el dia/mes un periodo hacia atras.
  return start.toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

const FLOW_BADGE: Record<
  ReportInsightFlowType,
  { label: string; severity: 'accent' | 'danger' | 'violet'; Icon: typeof TrendingUp }
> = {
  income: { label: 'Ingreso', severity: 'accent', Icon: TrendingUp },
  expense: { label: 'Gasto', severity: 'danger', Icon: TrendingDown },
  general: { label: 'General', severity: 'violet', Icon: Lightbulb },
}

/** Tasa de ahorro negativa (gastas mas de lo que ganas) es una señal real de
 * alerta -- antes siempre se pintaba verde sin importar el valor. Umbrales
 * de regla de dedo (10% ahorro = saludable), no hay un estandar oficial. */
function savingsRateColor(rate: number | undefined): string {
  const value = rate ?? 0
  if (value < 0) return 'var(--nl-danger-ink)'
  if (value < 0.1) return 'var(--nl-warning-ink)'
  return 'var(--nl-accent-ink)'
}

/** DTI (deuda/ingreso) alto es la misma historia -- antes se mostraba en
 * texto plano sin importar que tan alto fuera. >=36% es el umbral clasico de
 * "zona de riesgo" en finanzas personales. */
function dtiColor(dti: number | undefined): string | undefined {
  const value = dti ?? 0
  if (value >= 0.36) return 'var(--nl-danger-ink)'
  if (value >= 0.2) return 'var(--nl-warning-ink)'
  return undefined
}

function InsightRow({ insight }: { insight: ReportInsight }) {
  const badge = FLOW_BADGE[insight.flow_type]
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
  return (
    <>
      <HelpSection heading="Qué es esta pantalla">
        <p>
          Reportes de periodos ya cerrados (mes o año anterior) — a diferencia de Presupuesto/Dashboard,
          que son en tiempo real, un reporte es una "foto" congelada de un periodo que ya terminó, con
          análisis generado sobre esos números.
        </p>
      </HelpSection>
      <HelpSection heading="Generar mes/año anterior">
        <p>
          Los reportes no se crean solos — los generas cuando quieras verlos. Un reporte anual necesita
          que ya existan los reportes mensuales de ese año.
        </p>
      </HelpSection>
      <HelpSection heading="Regenerar un reporte">
        <p>
          El ícono junto al selector de periodo recalcula desde cero el reporte que estás viendo, con tus
          transacciones actuales — útil si generaste un reporte antes de cargar historial viejo y quedó
          casi vacío. En un reporte anual, también recalcula los 12 meses de ese año.
        </p>
      </HelpSection>
      <HelpSection heading="Ingresos / Egresos / Todos">
        <p>
          Filtra tanto la categoría destacada como los "Puntos de este periodo" (observaciones generadas
          por IA sobre ese reporte específico).
        </p>
      </HelpSection>
      <HelpSection heading="Patrimonio neto — histórico">
        <p>
          Junta todos tus reportes mensuales generados para dibujar la línea de tu patrimonio a lo largo
          del tiempo — entre más meses generes, más completa se ve.
        </p>
      </HelpSection>
      <HelpSection heading="Colores de Tasa de ahorro y DTI">
        <p>
          Tasa de ahorro: rojo si es negativa (gastaste más de lo que ganaste), naranja por debajo del
          10%, verde de ahí en adelante. DTI (deuda/ingreso): naranja desde 20%, rojo desde 36% — el
          umbral clásico de zona de riesgo en finanzas personales.
        </p>
      </HelpSection>
      <HelpTip>
        Tasa de ahorro y DTI son indicadores del reporte cerrado, no del mes en curso — para eso usa la
        nota "Mes en curso" al final de la página.
      </HelpTip>
    </>
  )
}

export function Reports() {
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
  // Entrada desde el sidebar ("Historial de patrimonio", /reports?section=networth)
  // -- abre la seccion (normalmente colapsada) y hace scroll hasta ella.
  // Solo se usa como estado inicial: netWorthOpen queda controlado por el
  // usuario despues, el link no debe re-abrirla en cada render.
  const [netWorthOpen, setNetWorthOpen] = useState(() => searchParams.get('section') === 'networth')
  const netWorthRef = useRef<HTMLDetailsElement>(null)
  // Copia del valor inicial de netWorthOpen (useRef solo usa este argumento
  // en el primer render) -- el efecto de scroll debe correr una sola vez al
  // entrar por el deep-link, no cada vez que netWorthOpen cambia despues
  // porque el usuario le dio click al <summary>.
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

  /** Recalcula desde cero el reporte que se esta viendo -- para cuando el
   * usuario backfillea historial viejo y este periodo ya se habia generado
   * (casi vacio) antes de cargar esas transacciones. En 'year' cascada:
   * el backend recalcula primero los 12 meses del año, luego el año (ver
   * report_service.generate_yearly_report, force=True). */
  async function regenerateCurrentReport() {
    if (!report || regenerating) return
    const ok = await confirm({
      title: 'Regenerar reporte',
      message:
        `Esto va a recalcular el reporte de ${periodLabel(report)} desde cero con las ` +
        `transacciones actuales, incluyendo los puntos de IA. ${
          period === 'year' ? 'También recalcula los 12 meses de ese año. ' : ''
        }¿Continuar?`,
      confirmLabel: 'Regenerar',
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

  // 'all' incluye tambien los insights 'general'; filtrado por income/expense
  // los excluye -- ver pregunta de diseño resuelta con el usuario.
  const insights = (report?.insights ?? []).filter((i) => flow === 'all' || i.flow_type === flow)
  const categorySide = flow === 'income' ? 'income' : 'expenses'
  const categories = (summary ? summary[categorySide].by_category : [])
    .slice()
    .sort((a, b) => Number(b.amount) - Number(a.amount))
    .slice(0, 8)
  // by_category solo trae el nombre (es un agregado ya congelado en el JSON
  // del reporte, no una FK viva a categories) -- se busca el color real por
  // nombre, mismo enfoque que ya usamos para arreglar el mismo problema en
  // Categorias/Dashboard/Transacciones/Cuentas.
  const categoryColorByName = new Map((sideCategories ?? []).map((c) => [c.name, c.color]))

  const netWorthSeries = monthlyReports
    .slice()
    .sort((a, b) => a.period_start.localeCompare(b.period_start))
  const netWorthValues = netWorthSeries.map((r) => Number(r.summary!.net_worth.end))
  const netWorthLabels = netWorthSeries.map((r) =>
    new Date(r.period_start).toLocaleDateString('es-MX', { month: 'short', timeZone: 'UTC' }),
  )

  return (
    <div>
      <ViewHeader
        icon={<FileBarChart />}
        title="Reportes"
        help={<ReportsHelp />}
        section={HEADER_SECTIONS.inteligencia}
        tourKey="reports"
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              disabled={generateMonthly.isPending}
              onClick={() => generateMonthly.mutate({})}
              data-tour="reports:generate-month"
              className="flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[13px] border border-border text-muted-foreground hover:text-foreground disabled:opacity-60"
            >
              <FileBarChart size={14} />
              {generateMonthly.isPending ? 'Generando...' : 'Generar mes anterior'}
            </button>
            <button
              type="button"
              disabled={generateYearly.isPending}
              onClick={() => generateYearly.mutate({ year: new Date().getFullYear() - 1 })}
              className="flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[13px] font-medium disabled:opacity-60"
              style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
            >
              <FileBarChart size={14} />
              {generateYearly.isPending ? 'Generando...' : 'Generar año anterior'}
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
              { value: 'month', label: 'Mensual' },
              { value: 'year', label: 'Anual' },
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
              title="Regenerar este reporte desde cero"
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
            {period === 'month'
              ? 'Todavía no hay reportes mensuales generados. Usa el botón "Generar mes anterior".'
              : 'Todavía no hay reportes anuales. Genera primero los reportes mensuales del año, luego usa "Generar año anterior".'}
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 mb-4 lg:flex lg:gap-3 lg:flex-wrap">
            <StatCard compact icon={<TrendingUp />} label="Ingresos" value={formatMoney(summary?.income.total)} />
            <StatCard
              compact
              icon={<Receipt />}
              label="Gastos"
              value={formatMoney(summary?.expenses.total)}
              valueClassName="text-[color:var(--nl-warning-ink)]"
            />
            <StatCard
              compact
              icon={<PiggyBank />}
              label="Tasa de ahorro"
              value={
                <span style={{ color: savingsRateColor(summary?.savings_rate) }}>
                  {Math.round((summary?.savings_rate ?? 0) * 100)}%
                </span>
              }
            />
            <StatCard
              compact
              icon={<Scale />}
              label="DTI"
              value={
                <span style={{ color: dtiColor(summary?.dti) }}>
                  {Math.round((summary?.dti ?? 0) * 100)}%
                </span>
              }
            />
            <StatCard
              compact
              icon={<HeartPulse />}
              label="Salud financiera"
              value={summary?.health_score.value ?? '—'}
              note={
                summary?.health_score.trend === 'improved'
                  ? '↑ mejoró vs anterior'
                  : summary?.health_score.trend === 'worsened'
                    ? '↓ empeoró vs anterior'
                    : summary?.health_score.trend === 'stable'
                      ? '→ estable'
                      : undefined
              }
            />
          </div>

          {summary?.adjustments && summary.adjustments.count > 0 && (
            <div
              className="flex items-center gap-3 rounded-md border p-3.5 mb-4"
              style={{ background: 'var(--nl-bg-card)', borderColor: 'var(--nl-border)' }}
            >
              <RefreshCcw size={16} className="text-muted-foreground flex-shrink-0" />
              <span className="text-[13px] flex-1">
                <strong>{summary.adjustments.count}</strong> ajuste{summary.adjustments.count === 1 ? '' : 's'} de
                saldo este período — entradas {formatMoney(summary.adjustments.total_in)}, salidas{' '}
                {formatMoney(summary.adjustments.total_out)}, neto{' '}
                <span
                  style={{
                    color:
                      Number(summary.adjustments.net) >= 0 ? 'var(--nl-accent-ink)' : 'var(--nl-danger-ink)',
                  }}
                >
                  {formatMoney(summary.adjustments.net)}
                </span>
                .
              </span>
              <Link to="/transactions" className="text-xs text-muted-foreground hover:text-foreground">
                Ver en Transacciones →
              </Link>
            </div>
          )}

          <div className="flex justify-end mb-4">
            <SegmentedControl
              value={flow}
              onChange={setFlow}
              options={[
                { value: 'all', label: 'Todos' },
                { value: 'income', label: 'Ingresos' },
                { value: 'expense', label: 'Egresos' },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start mb-4">
            <div className="bg-card border border-border rounded-md p-4">
              <div className="flex items-center gap-2 mb-2">
                <PieChart size={15} className="text-muted-foreground" />
                <div className="text-[15px] font-medium">
                  Categorías de {categorySide === 'income' ? 'ingreso' : 'gasto'}
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
                <p className="text-sm text-muted-foreground">Sin movimientos en esta categoría.</p>
              )}
            </div>

            <div className="bg-card border border-border rounded-md p-4">
              <div className="flex items-center gap-2 mb-1">
                <Lightbulb size={15} className="text-muted-foreground" />
                <div className="text-[15px] font-medium">Puntos de este periodo</div>
              </div>
              <p className="text-[11px] text-muted-foreground mb-2">Generados por IA a partir del resumen ya cerrado.</p>
              {insights.length > 0 ? (
                insights.map((i) => <InsightRow key={i.id} insight={i} />)
              ) : (
                <p className="text-sm text-muted-foreground py-4">Sin puntos para este filtro.</p>
              )}
            </div>
          </div>

          <details
            ref={netWorthRef}
            open={netWorthOpen}
            onToggle={(e) => setNetWorthOpen(e.currentTarget.open)}
            className="bg-card border border-border rounded-md p-4"
          >
            <summary className="flex items-center gap-2 text-[15px] font-medium cursor-pointer select-none">
              <TrendingUp size={15} className="text-muted-foreground" />
              Patrimonio neto — histórico
            </summary>
            <div className="mt-4">
              {netWorthValues.length >= 2 ? (
                <LineChart series={netWorthValues} xLabels={netWorthLabels} height={220} />
              ) : (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  Genera reportes de meses anteriores para ver el histórico de patrimonio neto aquí.
                </p>
              )}
            </div>
          </details>
        </>
      )}

      {current && (
        <p className="text-[11px] text-muted-foreground mt-4">
          Mes en curso (sin cerrar): ingresos {formatMoney(current.income.total)}, gastos{' '}
          {formatMoney(current.expenses.total)}.
        </p>
      )}
    </div>
  )
}
