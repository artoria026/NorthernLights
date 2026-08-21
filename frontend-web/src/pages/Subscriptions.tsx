import {
  CalendarClock,
  Check,
  CheckCircle2,
  Lock,
  Pause,
  PauseCircle,
  Pencil,
  Plus,
  Repeat,
  RotateCcw,
  X,
  XCircle,
} from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CategorySelect } from '@/components/nl/CategorySelect'
import { DialogFooter, DialogPrimaryButton } from '@/components/nl/DialogActions'
import { HelpSection, HelpTip } from '@/components/nl/Help'
import { EmptyState, HEADER_SECTIONS, SegmentedControl, SoftBadge, StatCard, ViewHeader } from '@/components/nl/primitives'
import { FREQUENCY_LABELS, monthlyEquivalent, STATUS_LABELS } from '@/lib/recurring'
import { formatMoney, formatShortDate, selectClass } from '@/lib/utils'
import { useAccounts } from '@/hooks/useAccounts'
import { useCategories } from '@/hooks/useCategories'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import {
  type CreateRecurringItemInput,
  type UpdateRecurringItemInput,
  useCancelRecurringItem,
  useCreateRecurringItem,
  usePauseRecurringItem,
  useRecurringItems,
  useResumeRecurringItem,
  useUpcomingRecurring,
  useUpdateRecurringItem,
} from '@/hooks/useRecurring'
import { apiErrorMessage } from '@/services/api'
import type { RecurringFrequency, RecurringItem } from '@/types'

const FREQUENCIES: RecurringFrequency[] = ['weekly', 'biweekly', 'monthly', 'bimonthly', 'annual']
type StatusFilter = 'active' | 'paused' | 'cancelled' | 'all'

/** Desde cuando esta activa, en meses -- created_at ya existia pero no se
 * mostraba; util para notar una suscripcion que lleva mucho sin revisarse. */
function monthsSince(dateStr: string): number {
  const start = new Date(dateStr)
  const now = new Date()
  return (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
}

function activeSinceLabel(dateStr: string): string {
  const months = monthsSince(dateStr)
  if (months <= 0) return 'Activa este mes'
  if (months === 1) return 'Activa desde hace 1 mes'
  return `Activa desde hace ${months} meses`
}

function NewSubscriptionForm({ onDone }: { onDone: () => void }) {
  const { data: accounts } = useAccounts()
  const { data: categories } = useCategories('expense')
  const createItem = useCreateRecurringItem()
  const [form, setForm] = useState<CreateRecurringItemInput>({
    name: '',
    item_type: 'subscription',
    amount: '',
    frequency: 'monthly',
    account_id: '',
    category_id: '',
    next_date: new Date().toISOString().slice(0, 10),
    auto_generate: true,
  })
  const payingAccounts = accounts?.filter((a) => a.type === 'asset' || a.type === 'liability')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form.category_id || !form.account_id) return
    try {
      await createItem.mutateAsync(form)
      onDone()
    } catch {
      // error mostrado abajo
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Nombre</label>
        <input
          required
          autoFocus
          placeholder="Ej: Spotify, Netflix, Claude Pro"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Monto</label>
        <input
          type="number"
          step="0.01"
          required
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Frecuencia de cobro</label>
        <Select
          value={form.frequency}
          onValueChange={(v) => setForm({ ...form, frequency: (v as RecurringFrequency) ?? 'monthly' })}
        >
          <SelectTrigger className={selectClass}>
            <SelectValue>{FREQUENCY_LABELS[form.frequency]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {FREQUENCIES.map((f) => (
              <SelectItem key={f} value={f}>
                {FREQUENCY_LABELS[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {form.amount && (
          <p className="text-xs text-muted-foreground">
            ≈ {formatMoney(monthlyEquivalent(form.amount, form.frequency))} / mes
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Categoría</label>
        <CategorySelect
          categories={categories}
          value={form.category_id}
          onValueChange={(v) => setForm({ ...form, category_id: v })}
          placeholder="Selecciona categoría"
          triggerClassName={selectClass}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Cuenta que paga (banco/TDC)</label>
        <Select value={form.account_id || null} onValueChange={(v) => setForm({ ...form, account_id: v ?? '' })}>
          <SelectTrigger className={selectClass}>
            <SelectValue placeholder="Selecciona cuenta">
              {(v: string | null) => payingAccounts?.find((a) => a.id === v)?.name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {payingAccounts?.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Próximo cobro</label>
        <input
          type="date"
          required
          value={form.next_date}
          onChange={(e) => setForm({ ...form, next_date: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      {createItem.isError && (
        <p className="text-sm text-destructive">{apiErrorMessage(createItem.error)}</p>
      )}
      <DialogFooter>
        <DialogPrimaryButton icon={Plus} pending={createItem.isPending}>
          Crear suscripción
        </DialogPrimaryButton>
      </DialogFooter>
    </form>
  )
}

function EditSubscriptionForm({ item, onDone }: { item: RecurringItem; onDone: () => void }) {
  const { data: accounts } = useAccounts()
  const { data: categories } = useCategories('expense')
  const payingAccounts = accounts?.filter((a) => a.type === 'asset' || a.type === 'liability')
  const updateItem = useUpdateRecurringItem()

  const [form, setForm] = useState<UpdateRecurringItemInput>({
    name: item.name,
    amount: item.amount,
    frequency: item.frequency,
    account_id: item.account_id,
    category_id: item.category_id,
    next_date: item.next_date,
  })

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      await updateItem.mutateAsync({ id: item.id, input: form })
      onDone()
    } catch {
      // error mostrado abajo
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Nombre</label>
        <input
          required
          autoFocus
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Monto</label>
        <input
          type="number"
          step="0.01"
          required
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Frecuencia de cobro</label>
        <Select
          value={form.frequency}
          onValueChange={(v) => setForm({ ...form, frequency: (v as RecurringFrequency) ?? 'monthly' })}
        >
          <SelectTrigger className={selectClass}>
            <SelectValue>{(v: RecurringFrequency) => FREQUENCY_LABELS[v]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {FREQUENCIES.map((f) => (
              <SelectItem key={f} value={f}>
                {FREQUENCY_LABELS[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {form.amount && form.frequency && (
          <p className="text-xs text-muted-foreground">
            ≈ {formatMoney(monthlyEquivalent(form.amount, form.frequency))} / mes
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Categoría</label>
        <CategorySelect
          categories={categories}
          value={form.category_id}
          onValueChange={(v) => setForm({ ...form, category_id: v })}
          placeholder="Selecciona categoría"
          triggerClassName={selectClass}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Cuenta que paga (banco/TDC)</label>
        <Select value={form.account_id || null} onValueChange={(v) => setForm({ ...form, account_id: v ?? '' })}>
          <SelectTrigger className={selectClass}>
            <SelectValue placeholder="Selecciona cuenta">
              {(v: string | null) => payingAccounts?.find((a) => a.id === v)?.name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {payingAccounts?.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Próximo cobro</label>
        <input
          type="date"
          required
          value={form.next_date}
          onChange={(e) => setForm({ ...form, next_date: e.target.value })}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      {updateItem.isError && <p className="text-sm text-destructive">{apiErrorMessage(updateItem.error)}</p>}
      <DialogFooter>
        <DialogPrimaryButton icon={Check} pending={updateItem.isPending}>
          Guardar cambios
        </DialogPrimaryButton>
      </DialogFooter>
    </form>
  )
}

const STATUS_SEVERITY: Record<RecurringItem['status'], 'accent' | 'warning' | 'danger'> = {
  active: 'accent',
  paused: 'warning',
  cancelled: 'danger',
}

function SubscriptionRow({ item, categoryName, categoryColor }: { item: RecurringItem; categoryName: string; categoryColor: string }) {
  const pause = usePauseRecurringItem()
  const cancel = useCancelRecurringItem()
  const resume = useResumeRecurringItem()
  const busy = pause.isPending || cancel.isPending || resume.isPending
  const [editOpen, setEditOpen] = useState(false)
  const isDesktop = useIsDesktop()
  const oldEnough = item.status === 'active' && monthsSince(item.created_at) >= 12

  // Un solo Dialog con estado local -- ver mismo comentario en
  // RecurringItemRow (pages/Recurring.tsx). isDesktop decide cual layout de
  // abajo se monta, nunca los dos a la vez.
  const actions = (
    <>
      <SoftBadge severity={STATUS_SEVERITY[item.status]}>{STATUS_LABELS[item.status]}</SoftBadge>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogTrigger
          render={
            <button
              type="button"
              disabled={busy}
              title="Editar"
              className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-info/10 hover:text-info disabled:opacity-40"
            >
              <Pencil size={13} />
            </button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar — {item.name}</DialogTitle>
          </DialogHeader>
          <EditSubscriptionForm item={item} onDone={() => setEditOpen(false)} />
        </DialogContent>
      </Dialog>
      {item.status === 'active' ? (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => pause.mutate(item.id)}
            title="Pausar"
            className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-warning/10 hover:text-warning disabled:opacity-40"
          >
            <Pause size={13} />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => cancel.mutate(item.id)}
            title="Cancelar"
            className="w-7 h-7 rounded-full flex items-center justify-center text-destructive hover:bg-destructive/10 disabled:opacity-40"
          >
            <X size={13} />
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => resume.mutate(item.id)}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium disabled:opacity-40"
          style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
        >
          <RotateCcw size={12} />
          Reactivar
        </button>
      )}
    </>
  )

  const meta = (
    <div className="flex items-center gap-3 flex-wrap mt-1.5 pl-0.5 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: categoryColor }} />
        {categoryName}
      </span>
      {item.status === 'active' && (
        <span style={oldEnough ? { color: 'var(--nl-warning-ink)' } : undefined}>
          {activeSinceLabel(item.created_at)}
          {oldEnough ? ' — ¿la sigues usando?' : ''}
        </span>
      )}
    </div>
  )

  if (isDesktop) {
    return (
      <div className="py-2.5 border-t border-border first:border-0">
        <div className="grid grid-cols-[2fr_1.2fr_1fr_1fr_230px] gap-2 items-center text-[13px]">
          <span className="font-medium truncate">{item.name}</span>
          <span className="text-muted-foreground">
            {formatMoney(item.amount)} · {FREQUENCY_LABELS[item.frequency]}
          </span>
          <span className="text-right">≈ {formatMoney(monthlyEquivalent(item.amount, item.frequency))}/mes</span>
          <span className="text-right text-muted-foreground">{item.next_date}</span>
          <span className="flex justify-end items-center gap-1.5" data-tour="subscriptions:item-actions">
            {actions}
          </span>
        </div>
        <div data-tour="subscriptions:aging">{meta}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 py-3 border-t border-border first:border-0 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium truncate">{item.name}</span>
        <span className="flex-shrink-0">
          ≈ {formatMoney(monthlyEquivalent(item.amount, item.frequency))}/mes
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
        <span>
          {formatMoney(item.amount)} · {FREQUENCY_LABELS[item.frequency]}
        </span>
        <span>{item.next_date}</span>
      </div>
      {meta}
      <div className="flex items-center gap-1.5 flex-wrap mt-1">{actions}</div>
    </div>
  )
}

function SubscriptionsHelp() {
  return (
    <>
      <HelpSection heading="Qué es esta pantalla">
        <p>
          Tus suscripciones (streaming, software, membresías) por separado de otros recurrentes — así
          puedes ver de un vistazo cuánto te cuestan al mes en total, sin mezclarlas con renta o servicios.
        </p>
      </HelpSection>
      <HelpSection heading="Comprometido mensual">
        <p>
          Como no todas cobran cada mes (algunas son anuales o quincenales), el total convierte cada
          frecuencia a su equivalente mensual para que la suma tenga sentido.
        </p>
      </HelpSection>
      <HelpSection heading="Editar / Pausar / Cancelar / Reanudar">
        <p>
          Editar cambia monto, frecuencia, cuenta, categoría o próximo cobro sin perder el historial —
          úsalo cuando te suban el precio (pasa seguido con streaming y software). Pausar detiene el
          cobro automático sin perder la configuración. Cancelar es definitivo. Ambas se pueden revertir.
        </p>
      </HelpSection>
      <HelpSection heading="Activa desde hace N meses">
        <p>
          Un recordatorio pasivo de cuánto tiempo lleva una suscripción activa — a partir de 12 meses te
          lo señala, para que de vez en cuando te preguntes si de verdad la sigues usando.
        </p>
      </HelpSection>
      <HelpSection heading="Próximas renovaciones">
        <p>
          Las que se cobran en los siguientes 7 días, para que ningún cargo te agarre desprevenido.
        </p>
      </HelpSection>
      <HelpTip>
        El monto se registra automáticamente en Transacciones cuando llega la fecha de cobro — te aparece
        primero como pendiente de confirmar en Recurrentes.
      </HelpTip>
    </>
  )
}

const FALLBACK_CATEGORY_COLOR = 'var(--nl-text-muted)'

export function Subscriptions() {
  const { data: items, isLoading } = useRecurringItems({ item_type: 'subscription' })
  const { data: categories } = useCategories('expense')
  const { data: upcoming } = useUpcomingRecurring(7)
  const [status, setStatus] = useState<StatusFilter>('active')
  const [open, setOpen] = useState(false)

  const all = items ?? []
  const active = all.filter((i) => i.status === 'active')
  const paused = all.filter((i) => i.status === 'paused')
  const cancelled = all.filter((i) => i.status === 'cancelled')
  const visible = status === 'all' ? all : all.filter((i) => i.status === status)
  const committedMonthly = active.reduce((sum, i) => sum + monthlyEquivalent(i.amount, i.frequency), 0)
  const upcomingRenewals = (upcoming ?? []).filter((i) => i.item_type === 'subscription')

  return (
    <div>
      <ViewHeader
        icon={<Repeat />}
        title="Suscripciones"
        help={<SubscriptionsHelp />}
        section={HEADER_SECTIONS.compromisos}
        tourKey="subscriptions"
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger
              render={
                <button
                  type="button"
                  data-tour="subscriptions:new-button"
                  className="flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[13px] font-medium"
                  style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
                >
                  <Plus size={14} />
                  Nueva suscripción
                </button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nueva suscripción</DialogTitle>
              </DialogHeader>
              <NewSubscriptionForm onDone={() => setOpen(false)} />
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 mb-4 lg:flex lg:gap-3 lg:flex-wrap">
        <StatCard
          compact
          icon={<Lock />}
          label="Comprometido en suscripciones / mes"
          value={formatMoney(committedMonthly)}
          note={`≈ ${formatMoney(committedMonthly * 12)} / año`}
          dataTour="subscriptions:committed"
        />
        <StatCard compact icon={<CheckCircle2 />} label="Activas" value={String(active.length)} />
        <StatCard
          compact
          icon={<PauseCircle />}
          label="Pausadas"
          value={String(paused.length)}
          valueClassName="text-[color:var(--nl-warning-ink)]"
        />
        <StatCard
          compact
          icon={<XCircle />}
          label="Canceladas"
          value={String(cancelled.length)}
          valueClassName="text-muted-foreground"
        />
      </div>

      <div className="bg-card border border-border rounded-md p-4 mb-4" data-tour="subscriptions:renewals">
        <div className="text-[15px] font-medium mb-2">Próximas renovaciones (7 días)</div>
        {upcomingRenewals.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada por renovarse en los próximos 7 días.</p>
        ) : (
          upcomingRenewals.map((item) => (
            <div key={item.id} className="flex items-center gap-2 lg:gap-3 py-2 border-t border-border first:border-0">
              <CalendarClock size={14} className="text-muted-foreground flex-shrink-0" />
              <span className="text-[13px] font-medium flex-1 min-w-0 truncate">{item.name}</span>
              <span className="text-[13px] text-muted-foreground w-16 lg:w-24 text-right flex-shrink-0">
                {formatShortDate(item.next_date)}
              </span>
              <span className="text-[13px] w-20 lg:w-28 text-right flex-shrink-0">{formatMoney(item.amount)}</span>
            </div>
          ))
        )}
      </div>

      <div className="bg-card border border-border rounded-md p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div className="text-[15px] font-medium">Todas tus suscripciones</div>
          <div data-tour="subscriptions:status-filter">
            <SegmentedControl
              value={status}
              onChange={setStatus}
              options={[
                { value: 'active', label: 'Activas' },
                { value: 'paused', label: 'Pausadas' },
                { value: 'cancelled', label: 'Canceladas' },
                { value: 'all', label: 'Todas' },
              ]}
            />
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando...</p>
        ) : visible.length === 0 ? (
          <EmptyState>
            {status === 'active'
              ? 'No tienes suscripciones activas.'
              : `No tienes suscripciones ${STATUS_LABELS[status as RecurringItem['status']]?.toLowerCase() ?? ''}.`}
          </EmptyState>
        ) : (
          <>
            <div className="hidden lg:grid grid-cols-[2fr_1.2fr_1fr_1fr_230px] gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              <span>Nombre</span>
              <span>Cobro</span>
              <span className="text-right">Equivalente mensual</span>
              <span className="text-right">Próximo cobro</span>
              <span className="text-right">Estado / Acción</span>
            </div>
            {visible.map((item) => {
              const category = categories?.find((c) => c.id === item.category_id)
              return (
                <SubscriptionRow
                  key={item.id}
                  item={item}
                  categoryName={category?.name ?? 'Sin categoría'}
                  categoryColor={category?.color ?? FALLBACK_CATEGORY_COLOR}
                />
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
