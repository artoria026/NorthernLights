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
import { formatMoney, selectClass } from '@/lib/utils'
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

/** Edita el limite de TODAS las categorias de gasto en una sola pantalla en
 * vez de una a la vez -- el backend ya hacia upsert por categoria
 * (budget_service.set_limits), asi que mandar varias de un jalon con
 * useSetBudgetLimits no le pisa nada a las que no se tocan, solo faltaba un
 * formulario que aprovechara eso. useBudgetLimitSuggestions (a diferencia de
 * useBudgetCurrent) trae TODAS las categorias de gasto con su color real y
 * su promedio de los ultimos 3 meses, incluidas las que nunca tuvieron
 * limite -- de ahi sale tanto el color del punto como la sugerencia. */
function SetLimitsForm({ onDone, viewingPastMonth }: { onDone: () => void; viewingPastMonth?: boolean }) {
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
      // error mostrado abajo
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-[12px] text-muted-foreground">
        Ponle límite mensual a las categorías que quieras controlar. Deja vacías las que no te interesa
        limitar.
        {viewingPastMonth && ' Esto afecta el mes en curso, no el mes pasado que estás viendo.'}
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
                  placeholder="Sin límite"
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
                  Promedio 3 meses: <span className="font-medium">{formatMoney(s.average_last_3_months)}</span>
                </button>
              )}
            </div>
          )
        })}
        {(suggestions ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground py-2 col-span-2">Sin categorías de gasto.</p>
        )}
      </div>
      {setLimits.isError && <p className="text-sm text-destructive">{apiErrorMessage(setLimits.error)}</p>}
      <DialogFooter>
        <DialogPrimaryButton icon={Check} pending={setLimits.isPending}>
          Guardar cambios
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
  /** Gasto de esta misma categoria en el mes anterior -- undefined si no hay
   * dato (categoria nueva o mes anterior sin movimiento) para no mostrar
   * flecha con un 0 falso. */
  prevSpent?: number
  /** average_last_3_months se calcula siempre respecto a HOY (no al mes que
   * se esta viendo) -- mostrar la sugerencia de limite mientras se navega un
   * mes pasado mezclaria un dato "de hoy" con una fila historica. */
  showSuggestions?: boolean
}) {
  const setLimit = useSetBudgetLimits()
  const average = Number(category.average_last_3_months)
  const limit = Number(category.monthly_limit)
  const spent = Number(category.spent)
  // Solo vale la pena sugerir el promedio si hay datos y difiere de verdad
  // del limite actual -- si ya coinciden (o no hay historial) no hay nada que sugerir.
  const showSuggestion = showSuggestions && average > 0 && Math.abs(average - limit) >= 1
  // +/-5% se trata como "igual" para no mostrar una flecha por ruido minimo.
  const deltaPct = prevSpent && prevSpent > 0 ? ((spent - prevSpent) / prevSpent) * 100 : null
  const trend = deltaPct === null || Math.abs(deltaPct) < 5 ? null : deltaPct > 0 ? 'up' : 'down'

  const trendIcon = trend && (
    <span
      className="flex items-center gap-0.5"
      style={{ color: trend === 'up' ? 'var(--nl-danger-ink)' : 'var(--nl-accent-ink)' }}
      title={`${trend === 'up' ? '+' : ''}${Math.round(deltaPct as number)}% vs mes anterior`}
    >
      {trend === 'up' ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
    </span>
  )

  return (
    <div className="py-3 border-t border-border first:border-0">
      {/* Fila de tabla -- solo lg+ */}
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

      {/* Card -- solo mobile */}
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
            Promedio últimos 3 meses: <span className="font-medium">{formatMoney(category.average_last_3_months)}</span>
            {average > limit ? ' (por arriba de tu límite)' : ' (por debajo de tu límite)'}
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
            Usar este monto
          </button>
        </div>
      )}
    </div>
  )
}

function BudgetHelp() {
  return (
    <>
      <HelpSection heading="Qué es esta pantalla">
        <p>
          Cuánto planeas gastar por categoría de gasto variable (comida, transporte, etc.) cada mes,
          contra lo que realmente llevas gastado — separado de tus gastos fijos comprometidos (deudas,
          recurrentes).
        </p>
      </HelpSection>
      <HelpSection heading="Definir límite">
        <p>
          Le pones un tope mensual a una categoría. Si no le has puesto límite a ninguna, no aparece nada
          en el desglose — es opcional, categoría por categoría.
        </p>
      </HelpSection>
      <HelpSection heading="Sugerencia de límite">
        <p>
          Cuando tu gasto promedio de los últimos 3 meses en una categoría difiere de su límite actual, te
          lo señala y te deja aplicarlo con un click — sin tener que calcularlo tú.
        </p>
      </HelpSection>
      <HelpSection heading="Disponible">
        <p>
          Ingreso estimado menos comprometido fijo menos gastado. Si se pone en rojo (negativo), ya te
          pasaste de lo que puedes gastar este mes.
        </p>
      </HelpSection>
      <HelpSection heading="Navegar meses pasados">
        <p>
          Usa las flechas junto al mes para revisar cómo te fue en meses anteriores. La vista semanal y la
          alerta de límite solo aplican al mes en curso — un mes cerrado ya no tiene "semana actual".
        </p>
      </HelpSection>
      <HelpSection heading="Flecha por categoría">
        <p>
          Compara el gasto de esta categoría contra el mes anterior. Roja hacia arriba si gastaste más de
          un 5%, verde hacia abajo si gastaste menos — sin flecha si es prácticamente igual.
        </p>
      </HelpSection>
      <HelpTip>
        "Comprometido fijo" son tus deudas y recurrentes activos — dinero que ya sabes que vas a gastar,
        por eso no compite con el presupuesto variable de arriba.
      </HelpTip>
    </>
  )
}

const MONTH_SHORT = new Intl.DateTimeFormat('es-MX', { month: 'short', timeZone: 'UTC' })
const MONTH_LONG = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' })

function monthLabel(year: number, month: number, formatter = MONTH_LONG) {
  const label = formatter.format(new Date(Date.UTC(year, month - 1, 1)))
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function Budget() {
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

  // Un mes sin ningun limite definido llega con budgeted=0 y percentage=0
  // -- eso no significa "gastaste 0%", significa "ese mes no tenias con que
  // comparar". Mostrarlo igual como una barra en 0% llena la grafica de
  // meses sin informacion real, se ve como ruido plano en vez de tendencia.
  const trendBars = (trend ?? [])
    .filter((m) => Number(m.budgeted) > 0)
    .map((m) => ({
      label: monthLabel(m.year, m.month, MONTH_SHORT),
      value: m.percentage,
      color: barColor(m.percentage),
    }))

  return (
    <div>
      <ViewHeader
        icon={<PiggyBank />}
        title="Presupuesto"
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
                  Definir límite
                </button>
              }
            />
            <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Límites mensuales por categoría</DialogTitle>
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
            aria-label="Mes anterior"
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
            aria-label="Mes siguiente"
          >
            <ChevronRight size={18} />
          </button>
          {!isCurrentMonth && (
            <button
              type="button"
              onClick={() => setViewed({ year: currentYear, month: currentMonth })}
              className="ml-2 text-[12px] text-muted-foreground hover:text-foreground underline"
            >
              Volver a hoy
            </button>
          )}
        </div>
        <Link
          to="/reports?period=month&flow=expense"
          className="text-[12px] text-muted-foreground hover:text-foreground"
        >
          Ver reporte completo del mes →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2.5 mb-4 lg:flex lg:gap-3 lg:flex-wrap">
        <StatCard
          compact
          icon={<Target />}
          label="Presupuestado"
          value={formatMoney(current?.variable_total_budgeted ?? '0')}
          note={`${categories.length} categoría${categories.length === 1 ? '' : 's'} con límite`}
        />
        <StatCard
          compact
          icon={<Receipt />}
          label="Gastado"
          value={<span style={{ color: barColorInk(spentPct) }}>{formatMoney(current?.variable_total_spent ?? '0')}</span>}
          borderColor={barColor(spentPct)}
          note={`${spentPct}% de lo presupuestado`}
        />
        <StatCard
          compact
          icon={<PiggyBank />}
          label="Disponible"
          dataTour="budget:available"
          value={
            <span style={{ color: Number(current?.available ?? 0) < 0 ? 'var(--nl-danger-ink)' : 'var(--nl-accent-ink)' }}>
              {formatMoney(current?.available ?? '0')}
            </span>
          }
          note={
            <>
              Ingreso estimado: {formatMoney(current?.income_estimated ?? '0')}
              {isCurrentMonth && ` · Quedan ${daysLeftInMonth} día${daysLeftInMonth === 1 ? '' : 's'}`}
            </>
          }
        />
        <StatCard
          compact
          icon={<Lock />}
          label="Comprometido fijo"
          value={formatMoney(current?.committed_fixed ?? '0')}
          note="Deudas y recurrentes activos"
          dataTour="budget:committed"
        />
      </div>

      {isCurrentMonth && alertCategories.length > 0 && (
        <div className="bg-card border border-border rounded-md p-3.5 mb-4" data-tour="budget:alerts">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={15} className="text-muted-foreground flex-shrink-0" />
            <span className="text-[13px] font-medium">
              {alertCategories.length} categoría{alertCategories.length === 1 ? '' : 's'} cerca o por encima del
              límite
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

      {/* Misma cuadricula regular de 4 columnas que Inicio -- cada tarjeta
          ocupa 2 de 4 (mitad), salvo Tendencia, que al abarcar hasta 12
          meses de barras se queda a ancho completo (4 de 4). "2x2, 4x2":
          bloques de tamano fijo dentro de la misma cuadricula, no fracciones
          custom por fila. */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">
        <div className="lg:col-span-2 bg-card border border-border rounded-md p-4">
          <div className="text-[15px] font-medium mb-2">Desglose por categoría</div>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">Define límites por categoría para ver tu progreso aquí.</p>
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
          <div className="text-[15px] font-medium mb-2">Distribución de gasto</div>
          {donutSlices.length > 0 ? (
            <div className="flex flex-col items-center gap-3">
              <Donut
                slices={donutSlices}
                centerLabel={formatMoney(current?.variable_total_spent ?? '0')}
                centerSub={isCurrentMonth ? 'este mes' : monthLabel(viewed.year, viewed.month, MONTH_SHORT)}
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
              {isCurrentMonth ? 'Sin gastos este mes todavía.' : 'Sin gastos registrados ese mes.'}
            </p>
          )}
        </div>

        <div className="lg:col-span-2 bg-card border border-border rounded-md p-4">
          <div className="text-[15px] font-medium mb-2">Pagos recurrentes</div>
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
            {(recurring ?? []).length === 0 && <p className="text-sm text-muted-foreground">Sin recurrentes activos.</p>}
          </div>
        </div>

        {isCurrentMonth ? (
          weekTotals && weekTotals.length > 0 && (
            <div className="lg:col-span-2 bg-card border border-border rounded-md p-4">
              <div className="text-[15px] font-medium mb-2">Vista semanal</div>
              <SimpleBars
                bars={weekTotals.map((w) => ({ label: `S${w.week}`, value: w.total }))}
                height={110}
                showValues
                formatValue={(v) => formatMoney(v.toFixed(2))}
              />
              <div className="flex flex-col mt-2">
                {weekTotals.map((week) => (
                  <div key={week.week} className="flex items-center justify-between py-2 border-t border-border first:border-0 text-[13px]">
                    <span className="text-muted-foreground">
                      Semana {week.week} · {week.date_from} — {week.date_to}
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
              La vista semanal solo aplica al mes en curso.
            </p>
            <button
              type="button"
              onClick={() => setViewed({ year: currentYear, month: currentMonth })}
              className="text-[12px] text-muted-foreground hover:text-foreground underline"
            >
              Volver a hoy para verla
            </button>
          </div>
        )}

        {trendBars.length > 0 && (
          <div className="lg:col-span-4 bg-card border border-border rounded-md p-3.5" data-tour="budget:trend">
            <div className="text-[13px] font-medium mb-1.5">Tendencia · % del presupuesto usado por mes</div>
            <SimpleBars bars={trendBars} height={70} showValues formatValue={(v) => `${Math.round(v)}%`} />
          </div>
        )}
      </div>
    </div>
  )
}
