import {
  ChevronLeft,
  ChevronRight,
  CreditCard,
  History,
  Lightbulb,
  ListChecks,
  PiggyBank,
  Receipt,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { HelpSection, HelpTip } from '@/components/nl/Help'
import { HEADER_SECTIONS, SoftBadge, StatCard, ViewHeader } from '@/components/nl/primitives'
import {
  useDismissInsight,
  useGenerateInsights,
  useInsightHistory,
  useInsightReviews,
  useInsights,
  useResolveInsight,
} from '@/hooks/useInsights'
import { apiErrorMessage } from '@/services/api'
import type { Insight, InsightCategory, InsightPriority, InsightStatus, InsightTrend } from '@/types'

const HISTORY_PAGE_SIZE = 10

const PRIORITY_SEVERITY: Record<InsightPriority, 'danger' | 'warning' | 'accent'> = {
  high: 'danger',
  medium: 'warning',
  low: 'accent',
}

const PRIORITY_LABELS: Record<InsightPriority, string> = {
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
}

const CATEGORY_LABELS: Record<InsightCategory, string> = {
  spending: 'Gasto',
  debt: 'Deuda',
  savings: 'Ahorro',
  income: 'Ingreso',
  budget: 'Presupuesto',
  general: 'General',
}

const CATEGORY_ICONS: Record<InsightCategory, LucideIcon> = {
  spending: Receipt,
  debt: CreditCard,
  savings: PiggyBank,
  income: TrendingUp,
  budget: Target,
  general: Lightbulb,
}

const TREND_LABELS: Record<InsightTrend, string> = {
  improved: 'Mejoró',
  worsened: 'Empeoró',
  stable: 'Estable',
}

const TREND_SEVERITY: Record<InsightTrend, 'accent' | 'danger' | 'warning'> = {
  improved: 'accent',
  worsened: 'danger',
  stable: 'warning',
}

const STATUS_LABEL: Record<InsightStatus, string> = {
  active: 'Activo',
  dismissed: 'Descartado',
  resolved: 'Resuelto',
}

/** The only 3 keys that _extract_key_metrics (insight_service.py) writes
 * into metrics_at_creation/metrics_at_last_review/InsightReview.metrics --
 * fixed shape, no need to handle arbitrary keys. `higherIsBetter` decides
 * the change arrow's color (less monthly committed IS an improvement,
 * that's why it's false). */
const METRIC_FIELDS: { key: string; label: string; format: 'money' | 'score'; higherIsBetter: boolean }[] = [
  { key: 'net_worth', label: 'Patrimonio neto', format: 'money', higherIsBetter: true },
  { key: 'health_score', label: 'Salud financiera', format: 'score', higherIsBetter: true },
  { key: 'committed_monthly', label: 'Comprometido mensual', format: 'money', higherIsBetter: false },
]

/** net_worth/committed_monthly arrive as a string (Decimal -> str via
 * json_safe, same as any "amount" in the rest of the app) -- health_score
 * does arrive as a native float. Both need to be accepted. */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value)
  return null
}

function formatMetric(value: unknown, format: 'money' | 'score'): string {
  const num = toNumber(value)
  if (num === null) return '—'
  return format === 'money'
    ? num.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 })
    : `${Math.round(num)}/100`
}

function MetricsComparison({
  before,
  after,
}: {
  before: Record<string, unknown>
  after: Record<string, unknown>
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
      {METRIC_FIELDS.map((field) => {
        const beforeValue = toNumber(before[field.key])
        const afterValue = toNumber(after[field.key])
        const delta = beforeValue !== null && afterValue !== null ? afterValue - beforeValue : null
        const improved = delta !== null && (field.higherIsBetter ? delta > 0 : delta < 0)
        const worsened = delta !== null && (field.higherIsBetter ? delta < 0 : delta > 0)
        return (
          <div key={field.key} className="rounded-md border border-border p-2.5">
            <div className="text-[11px] text-muted-foreground mb-1">{field.label}</div>
            <div className="flex items-center gap-1.5 text-[13px]">
              <span className="text-muted-foreground">{formatMetric(beforeValue, field.format)}</span>
              <span className="text-muted-foreground">→</span>
              <span className="font-medium">{formatMetric(afterValue, field.format)}</span>
              {improved && <TrendingUp size={13} style={{ color: 'var(--nl-accent-ink)' }} />}
              {worsened && <TrendingDown size={13} style={{ color: 'var(--nl-danger-ink)' }} />}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** useInsightReviews is only enabled with reviewsOpen=true -- if you never
 * open an insight's modal, its reviews are never requested (avoids N
 * fetches all at once when loading the active list). */
function ReviewsDialog({ insight }: { insight: Insight }) {
  const [open, setOpen] = useState(false)
  const { data: reviews, isLoading } = useInsightReviews(open ? insight.id : null)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="rounded px-3 py-1.5 text-[12px] border border-border text-muted-foreground hover:text-foreground"
          >
            Ver revisiones ({insight.review_count})
          </button>
        }
      />
      <DialogContent className="max-h-[75vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Revisiones — {insight.title}</DialogTitle>
        </DialogHeader>
        {insight.metrics_at_last_review && (
          <MetricsComparison before={insight.metrics_at_creation} after={insight.metrics_at_last_review} />
        )}
        <div className="flex flex-col gap-3 mt-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : (
            reviews?.map((review) => (
              <div key={review.id} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <SoftBadge severity={TREND_SEVERITY[review.trend]}>{TREND_LABELS[review.trend]}</SoftBadge>
                  <span className="text-xs text-muted-foreground">{review.reviewed_at.slice(0, 10)}</span>
                </div>
                <p className="text-[13px] text-muted-foreground">{review.ai_assessment}</p>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function InsightCard({ insight, tourTarget }: { insight: Insight; tourTarget?: boolean }) {
  const dismiss = useDismissInsight()
  const resolve = useResolveInsight()
  const CategoryIcon = CATEGORY_ICONS[insight.category]

  return (
    <div
      className="bg-card border border-border rounded-md p-4"
      style={{ borderLeft: `3px solid var(--nl-${PRIORITY_SEVERITY[insight.priority]})` }}
    >
      <div
        className="flex items-start justify-between gap-3 mb-1.5"
        data-tour={tourTarget ? 'insights:card' : undefined}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <CategoryIcon size={15} className="text-muted-foreground flex-shrink-0" />
          <p className="font-medium text-[13px]">{insight.title}</p>
          <SoftBadge severity={PRIORITY_SEVERITY[insight.priority]}>{PRIORITY_LABELS[insight.priority]}</SoftBadge>
          <SoftBadge severity="accent">{CATEGORY_LABELS[insight.category]}</SoftBadge>
        </div>
      </div>
      <p className="text-[13px] text-muted-foreground mb-2">{insight.description}</p>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Próxima revisión: {insight.next_review_at}
          {insight.review_count > 0 && ` · revisado ${insight.review_count}x`}
        </span>
        <div className="flex gap-2" data-tour={tourTarget ? 'insights:actions' : undefined}>
          {insight.review_count > 0 && <ReviewsDialog insight={insight} />}
          <button
            type="button"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate(insight.id)}
            className="rounded px-3 py-1.5 text-[12px] border border-border text-muted-foreground hover:text-foreground"
          >
            Marcar resuelto
          </button>
          <button
            type="button"
            disabled={dismiss.isPending}
            onClick={() => dismiss.mutate(insight.id)}
            className="rounded px-3 py-1.5 text-[12px] border border-border text-muted-foreground hover:text-foreground"
          >
            Descartar
          </button>
        </div>
      </div>
    </div>
  )
}

function InsightsHelp() {
  return (
    <>
      <HelpSection heading="Qué es esta pantalla">
        <p>
          Observaciones automáticas sobre tus finanzas basadas en tus datos reales (gasto, presupuesto,
          deudas) — un patrón detectado, una alerta, una sugerencia. Máximo 10 activos a la vez.
        </p>
      </HelpSection>
      <HelpSection heading="Generar insights">
        <p>
          Corre el análisis sobre tu situación actual y crea nuevos insights si encuentra algo que valga
          la pena señalarte. También se crean automáticamente cuando le pides al Asesor IA que guarde un
          plan.
        </p>
      </HelpSection>
      <HelpSection heading="Marcar resuelto / Descartar">
        <p>
          <strong>Resuelto</strong> es para cuando ya atendiste lo que decía. <strong>Descartar</strong> es
          para cuando no te interesa ese en particular. Ambos lo sacan de la lista activa y quedan en el
          historial de abajo.
        </p>
      </HelpSection>
      <HelpSection heading="Ver revisiones">
        <p>
          Mientras un insight sigue activo, se vuelve a evaluar solo (con tus datos del momento) en cada
          fecha de revisión, y la IA dice si tu situación mejoró, empeoró o se mantuvo igual — con una
          comparación de tus números clave (patrimonio, salud financiera, comprometido mensual) contra
          los del momento en que se creó.
        </p>
      </HelpSection>
      <HelpTip>
        La prioridad (alta/media/baja) refleja qué tan urgente es, no está ligada a ninguna acción
        automática — es solo para que decidas qué atender primero.
      </HelpTip>
    </>
  )
}

export function Insights() {
  const { data: active, isLoading } = useInsights()
  const [historyPage, setHistoryPage] = useState(1)
  const { data: history } = useInsightHistory(historyPage, HISTORY_PAGE_SIZE)
  const generate = useGenerateInsights()

  const totalHistoryPages = Math.max(1, Math.ceil((history?.meta?.total ?? 0) / HISTORY_PAGE_SIZE))

  return (
    <div>
      <ViewHeader
        icon={<TrendingUp />}
        title="Insights"
        help={<InsightsHelp />}
        section={HEADER_SECTIONS.inteligencia}
        tourKey="insights"
        actions={
          <button
            type="button"
            disabled={generate.isPending}
            onClick={() => generate.mutate()}
            data-tour="insights:generate"
            className="flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[13px] font-medium disabled:opacity-60"
            style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
          >
            <Sparkles size={14} />
            {generate.isPending ? 'Generando...' : 'Generar insights'}
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 mb-4 lg:flex lg:gap-3 lg:flex-wrap">
        <StatCard
          compact
          icon={<ListChecks />}
          label="Insights activos"
          value={`${active?.length ?? 0} / 10`}
          dataTour="insights:active"
        />
        <StatCard compact icon={<History />} label="Generados en total" value={String(history?.meta?.total ?? 0)} />
      </div>

      {generate.isError && (
        <p className="text-sm text-destructive mb-4">{apiErrorMessage(generate.error)}</p>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando...</p>
      ) : active && active.length > 0 ? (
        <div className="flex flex-col gap-2.5 mb-4">
          {active.map((insight, i) => (
            <InsightCard key={insight.id} insight={insight} tourTarget={i === 0} />
          ))}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-md p-8 text-center mb-4">
          <p className="text-sm text-muted-foreground">
            Sin insights activos. Genera nuevos o pídele al Asesor IA que guarde un plan.
          </p>
        </div>
      )}

      <div className="bg-card border border-border rounded-md p-4" data-tour="insights:history">
        <div className="text-[15px] font-medium mb-2">Historial</div>
        {!history || history.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay historial.</p>
        ) : (
          <>
            <div className="flex flex-col">
              {history.items.map((insight) => {
                const CategoryIcon = CATEGORY_ICONS[insight.category]
                return (
                  <div key={insight.id}>
                    <div className="hidden lg:grid grid-cols-[2fr_1fr_1fr_100px] gap-2 items-center py-2.5 border-t border-border first:border-0 text-[13px]">
                      <span className="truncate font-medium">{insight.title}</span>
                      <span className="flex items-center gap-1.5">
                        <CategoryIcon size={13} className="text-muted-foreground flex-shrink-0" />
                        <SoftBadge severity="accent">{CATEGORY_LABELS[insight.category]}</SoftBadge>
                      </span>
                      <span className="text-muted-foreground">{STATUS_LABEL[insight.status]}</span>
                      <span className="text-muted-foreground">{insight.created_at.slice(0, 10)}</span>
                    </div>
                    <div className="lg:hidden flex flex-col gap-1.5 py-3 border-t border-border first:border-0 text-[13px]">
                      <span className="truncate font-medium">{insight.title}</span>
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5">
                          <CategoryIcon size={13} className="text-muted-foreground flex-shrink-0" />
                          <SoftBadge severity="accent">{CATEGORY_LABELS[insight.category]}</SoftBadge>
                        </span>
                        <span className="text-muted-foreground text-[12px]">
                          {STATUS_LABEL[insight.status]} · {insight.created_at.slice(0, 10)}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            {totalHistoryPages > 1 && (
              <div className="flex justify-between items-center mt-3.5 text-xs text-muted-foreground">
                <span>
                  Página {historyPage} de {totalHistoryPages}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={historyPage <= 1}
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    className="rounded p-1.5 border border-border disabled:opacity-40"
                    aria-label="Página anterior"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={historyPage >= totalHistoryPages}
                    onClick={() => setHistoryPage((p) => Math.min(totalHistoryPages, p + 1))}
                    className="rounded p-1.5 border border-border disabled:opacity-40"
                    aria-label="Página siguiente"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
