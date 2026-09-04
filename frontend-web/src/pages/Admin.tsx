import {
  Activity,
  ArrowLeftRight,
  Bot,
  Bug,
  Building2,
  ChevronLeft,
  ChevronRight,
  Coins,
  KeyRound,
  Lightbulb,
  MessageSquare,
  Search,
  ShieldCheck,
  ShieldOff,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyState, ProgressBar, SoftBadge, StatCard, ViewHeader } from '@/components/nl/primitives'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SimpleBars } from '@/lib/charts'
import { formatShortDate, selectClass } from '@/lib/utils'
import {
  type AdminUser,
  useAdminStats,
  useAdminUsers,
  useResetUserPassword,
  useSetUserActive,
  useSetUserRole,
} from '@/hooks/useAdmin'
import {
  type AdminFeedback,
  type FeedbackStatus,
  useAdminFeedback,
  useUpdateFeedbackStatus,
} from '@/hooks/useFeedback'
import { apiErrorMessage } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import { useConfirmStore } from '@/stores/confirmStore'
import { useUiStore } from '@/stores/uiStore'

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Same thresholds already used by health_score in Advisor.tsx: 70+ is
 * healthy (green), 40-69 fair (orange), under 40 poor (red). Only the
 * composite score -- its components (DTI, savings rate, etc.) never reach
 * the admin frontend, see admin_service.list_users. */
function healthScoreColors(score: number): { bg: string; ink: string } {
  if (score >= 70) return { bg: 'var(--nl-accent-soft-bg)', ink: 'var(--nl-accent-ink)' }
  if (score >= 40) return { bg: 'var(--nl-warning-soft-bg)', ink: 'var(--nl-warning-ink)' }
  return { bg: 'var(--nl-danger-soft-bg)', ink: 'var(--nl-danger-ink)' }
}

function HealthScoreBadge({ score }: { score: number }) {
  const colors = healthScoreColors(score)
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: colors.bg, color: colors.ink }}
    >
      {Math.round(score)}
    </span>
  )
}

/** Same Google logo (4 colors) already used by Settings.tsx in "Connected
 * accounts" -- reused as-is so the "With Google" stat is recognizable at a
 * glance, instead of a generic icon. */
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" className="flex-shrink-0">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.9 32.6 29.4 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.6 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.3 0 10.1-2 13.7-5.3l-6.3-5.3C29.4 35.4 26.8 36 24 36c-5.3 0-9.9-3.4-11.3-8.1l-6.5 5C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.1-3.3 5.6-6.2 7.1l6.3 5.3C39.9 37.5 44 31.7 44 24c0-1.3-.1-2.7-.4-3.5z" />
    </svg>
  )
}

/** "Feature adoption" row -- % of total users who already have at least 1
 * record of that type, computed on the client (count/total already come
 * from the backend, no extra call). */
function AdoptionRow({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div className="flex flex-col gap-1.5 mb-3.5 last:mb-0">
      <div className="flex items-center justify-between text-[12.5px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">
          {pct}% <span className="text-muted-foreground font-normal">({count})</span>
        </span>
      </div>
      <ProgressBar pct={pct} />
    </div>
  )
}

function UserRow({ user, isSelf }: { user: AdminUser; isSelf: boolean }) {
  const setActive = useSetUserActive()
  const setRole = useSetUserRole()
  const resetPassword = useResetUserPassword()
  const confirm = useConfirmStore((s) => s.ask)
  const pushToast = useUiStore((s) => s.pushToast)
  const busy = setActive.isPending || setRole.isPending
  const [tempPassword, setTempPassword] = useState<string | null>(null)

  async function handleResetPassword() {
    const ok = await confirm({
      title: 'Restablecer contraseña',
      message: `¿Generar una contraseña temporal para "${user.name}" (${user.email})? Su contraseña actual deja de funcionar de inmediato.`,
      confirmLabel: 'Generar',
    })
    if (!ok) return
    try {
      const result = await resetPassword.mutateAsync(user.id)
      setTempPassword(result.temporary_password)
    } catch (error) {
      pushToast(apiErrorMessage(error), 'error')
    }
  }

  async function copyTempPassword() {
    if (!tempPassword) return
    try {
      await navigator.clipboard.writeText(tempPassword)
      pushToast('Contraseña copiada', 'success')
    } catch {
      pushToast('No se pudo copiar -- selecciónala manualmente', 'error')
    }
  }

  async function toggleActive() {
    if (user.is_active) {
      const ok = await confirm({
        title: 'Desactivar usuario',
        message: `¿Desactivar a "${user.name}" (${user.email})? No podrá iniciar sesión hasta que lo reactives.`,
        confirmLabel: 'Desactivar',
        variant: 'danger',
      })
      if (!ok) return
    }
    try {
      await setActive.mutateAsync({ id: user.id, is_active: !user.is_active })
    } catch (error) {
      pushToast(apiErrorMessage(error), 'error')
    }
  }

  async function toggleRole() {
    const nextRole = user.role === 'admin' ? 'user' : 'admin'
    const ok = await confirm({
      title: nextRole === 'admin' ? 'Hacer admin' : 'Quitar admin',
      message:
        nextRole === 'admin'
          ? `¿Dar permisos de admin a "${user.name}"?`
          : `¿Quitarle permisos de admin a "${user.name}"?`,
      confirmLabel: 'Confirmar',
      variant: nextRole === 'admin' ? 'default' : 'danger',
    })
    if (!ok) return
    try {
      await setRole.mutateAsync({ id: user.id, role: nextRole })
    } catch (error) {
      pushToast(apiErrorMessage(error), 'error')
    }
  }

  const roleBadge = (
    <SoftBadge severity={user.role === 'admin' ? 'violet' : 'blue'}>
      {user.role === 'admin' ? 'Admin' : 'Usuario'}
    </SoftBadge>
  )
  const statusBadge = (
    <SoftBadge severity={user.is_active ? 'accent' : 'danger'}>
      {user.is_active ? 'Activo' : 'Inactivo'}
    </SoftBadge>
  )
  const actionButtons = (
    <>
      {!isSelf && (
        <button
          type="button"
          disabled={busy}
          onClick={toggleRole}
          title={user.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}
          className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-info/10 hover:text-info disabled:opacity-40"
        >
          {user.role === 'admin' ? <ShieldOff size={13} /> : <ShieldCheck size={13} />}
        </button>
      )}
      <button
        type="button"
        disabled={busy || isSelf}
        title={isSelf ? 'No puedes desactivar tu propia cuenta' : user.is_active ? 'Desactivar' : 'Reactivar'}
        onClick={toggleActive}
        className={`w-7 h-7 rounded-full flex items-center justify-center disabled:opacity-40 ${
          user.is_active
            ? 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
            : 'text-muted-foreground hover:bg-success/10 hover:text-success'
        }`}
      >
        {user.is_active ? <UserX size={13} /> : <UserCheck size={13} />}
      </button>
      <button
        type="button"
        disabled={resetPassword.isPending}
        title="Restablecer contraseña"
        onClick={handleResetPassword}
        className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-warning/10 hover:text-warning disabled:opacity-40"
      >
        <KeyRound size={13} />
      </button>
    </>
  )

  return (
    <>
      {/* Table row -- lg+ only */}
      <div className="hidden lg:grid grid-cols-[1.1fr_75px_85px_60px_70px_65px_85px_75px_75px] gap-2 items-center py-3 border-t border-border first:border-0 text-[13px]">
        <div className="min-w-0">
          <div className="font-medium truncate">
            {user.name} {isSelf && <span className="text-muted-foreground">(tú)</span>}
          </div>
          <div className="text-muted-foreground text-[12px] truncate">{user.email}</div>
        </div>
        <span className="text-muted-foreground">{formatDate(user.created_at)}</span>
        <span className="text-muted-foreground">
          {user.last_active_at ? formatShortDate(user.last_active_at) : 'Nunca'}
        </span>
        <span className="text-right text-muted-foreground">{user.accounts_count}</span>
        <span className="text-right text-muted-foreground">{user.transactions_count}</span>
        <span>
          <HealthScoreBadge score={user.health_score} />
        </span>
        <span>{roleBadge}</span>
        <span>{statusBadge}</span>
        <span className="flex justify-end items-center gap-1">{actionButtons}</span>
      </div>

      {/* Card -- mobile only */}
      <div className="lg:hidden flex flex-col gap-2 py-3 border-t border-border first:border-0 text-[13px]">
        <div className="min-w-0">
          <div className="font-medium truncate">
            {user.name} {isSelf && <span className="text-muted-foreground">(tú)</span>}
          </div>
          <div className="text-muted-foreground text-[12px] truncate">{user.email}</div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {roleBadge}
          {statusBadge}
          <HealthScoreBadge score={user.health_score} />
        </div>
        <div className="text-[12px] text-muted-foreground">
          Desde {formatDate(user.created_at)} · {user.accounts_count} cuenta
          {user.accounts_count === 1 ? '' : 's'} · {user.transactions_count} transacc. · Última
          conexión: {user.last_active_at ? formatShortDate(user.last_active_at) : 'Nunca'}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">{actionButtons}</div>
      </div>

      {/* Temporary password -- shown ONCE, never kept in plain text anywhere
          except while this modal is open (local state, lost on close). */}
      <Dialog open={tempPassword !== null} onOpenChange={(next) => !next && setTempPassword(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Contraseña temporal — {user.name}</DialogTitle>
          </DialogHeader>
          <p className="text-[12.5px] text-muted-foreground">
            Pásasela al usuario ahora por fuera de la app — no se puede volver a ver.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md border border-border px-3 py-2 text-[13px] font-mono select-all">
              {tempPassword}
            </code>
            <button
              type="button"
              onClick={copyTempPassword}
              className="rounded-md border border-border px-3 py-2 text-[12.5px] text-muted-foreground hover:text-foreground"
            >
              Copiar
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: 'Nuevo',
  read: 'Leído',
  considered: 'Considerado',
  discarded: 'Descartado',
}

const FEEDBACK_STATUS_SEVERITY: Record<FeedbackStatus, 'blue' | 'warning' | 'accent' | 'danger'> = {
  new: 'blue',
  read: 'warning',
  considered: 'accent',
  discarded: 'danger',
}

// These two do trigger an in-app notification to the user who owns the
// feedback (see feedback_service._NOTIFY_STATUSES in the backend) -- that's
// why they're the only ones that open the dialog to ask for a note before
// applying the change; new/read are internal transitions that notify no one.
const _NOTIFYING_STATUSES: FeedbackStatus[] = ['considered', 'discarded']

function FeedbackRow({ item }: { item: AdminFeedback }) {
  const updateStatus = useUpdateFeedbackStatus()
  const pushToast = useUiStore((s) => s.pushToast)
  const TypeIcon = item.type === 'bug' ? Bug : Lightbulb
  const [pendingStatus, setPendingStatus] = useState<FeedbackStatus | null>(null)
  const [note, setNote] = useState('')

  async function applyStatus(status: FeedbackStatus, adminNote?: string) {
    try {
      await updateStatus.mutateAsync({ id: item.id, status, adminNote })
      setPendingStatus(null)
      setNote('')
    } catch (error) {
      pushToast(apiErrorMessage(error), 'error')
    }
  }

  function handleStatusChange(status: FeedbackStatus) {
    if (_NOTIFYING_STATUSES.includes(status)) {
      setNote(item.admin_note ?? '')
      setPendingStatus(status)
      return
    }
    void applyStatus(status)
  }

  const typeBadge = (
    <SoftBadge severity={item.type === 'bug' ? 'danger' : 'violet'}>
      <span className="flex items-center gap-1">
        <TypeIcon size={11} />
        {item.type === 'bug' ? 'Bug' : 'Sugerencia'}
      </span>
    </SoftBadge>
  )
  const statusSelect = (
    <Select
      value={item.status}
      disabled={updateStatus.isPending}
      onValueChange={(v) => handleStatusChange((v as FeedbackStatus) ?? item.status)}
    >
      <SelectTrigger className="h-7 text-[12px] w-[140px]">
        <SelectValue>{(v: FeedbackStatus) => FEEDBACK_STATUS_LABELS[v]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(FEEDBACK_STATUS_LABELS) as FeedbackStatus[]).map((status) => (
          <SelectItem key={status} value={status}>
            {FEEDBACK_STATUS_LABELS[status]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
  const noteText = item.admin_note ? (
    <p className="text-[12px] text-muted-foreground italic truncate" title={item.admin_note}>
      Nota: {item.admin_note}
    </p>
  ) : null

  return (
    <>
      {/* Table row -- lg+ only */}
      <div className="hidden lg:grid grid-cols-[100px_1fr_1.4fr_120px_140px] gap-2 items-center py-3 border-t border-border first:border-0 text-[13px]">
        <span>{typeBadge}</span>
        <div className="min-w-0">
          <div className="font-medium truncate">{item.user_name}</div>
          <div className="text-muted-foreground text-[12px] truncate">{item.user_email}</div>
        </div>
        <div className="min-w-0">
          <p className="text-muted-foreground truncate" title={item.message}>
            {item.message}
          </p>
          {noteText}
        </div>
        <span className="text-muted-foreground text-[12px]">{formatDate(item.created_at)}</span>
        <span className="flex justify-end">{statusSelect}</span>
      </div>

      {/* Card -- mobile only */}
      <div className="lg:hidden flex flex-col gap-2 py-3 border-t border-border first:border-0 text-[13px]">
        <div className="flex items-center gap-1.5 flex-wrap">
          {typeBadge}
          <SoftBadge severity={FEEDBACK_STATUS_SEVERITY[item.status]}>
            {FEEDBACK_STATUS_LABELS[item.status]}
          </SoftBadge>
        </div>
        <div className="min-w-0">
          <div className="font-medium truncate">
            {item.user_name} <span className="text-muted-foreground">· {item.user_email}</span>
          </div>
        </div>
        <p className="text-muted-foreground">{item.message}</p>
        {noteText}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-muted-foreground">{formatDate(item.created_at)}</span>
          {statusSelect}
        </div>
      </div>

      <Dialog open={pendingStatus !== null} onOpenChange={(open) => !open && setPendingStatus(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingStatus === 'considered' ? 'Marcar como considerado' : 'Marcar como descartado'}
            </DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-muted-foreground">
            {item.user_name} recibirá una notificación de este cambio. Puedes agregar una nota
            explicando el porqué -- es opcional, pero ayuda a que la respuesta no se sienta seca.
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ej. Lo agregamos al roadmap de Q4, o: no encaja con el enfoque actual de la app."
            rows={3}
            maxLength={2000}
            className={`${selectClass} h-auto resize-none py-2`}
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={() => setPendingStatus(null)}
              className="px-3 py-1.5 rounded-md text-[13px] text-muted-foreground hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={updateStatus.isPending}
              onClick={() => pendingStatus && applyStatus(pendingStatus, note.trim() || undefined)}
              className="px-3 py-1.5 rounded-md text-[13px] bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Confirmar
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

const USERS_PER_PAGE = 20

export function Admin() {
  const currentUser = useAuthStore((s) => s.user)
  const { data: stats } = useAdminStats()
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  // ~400ms debounce before firing the search -- avoids a request per
  // keystroke. Changing the search resets to page 1 (page 3 of a search
  // that only has 1 page wouldn't make sense).
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput)
      setPage(1)
    }, 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  const { data: users, isLoading } = useAdminUsers(page, USERS_PER_PAGE, search)
  const [feedbackFilter, setFeedbackFilter] = useState<FeedbackStatus | ''>('')
  const { data: feedbackItems, isLoading: feedbackLoading } = useAdminFeedback(
    feedbackFilter || undefined,
  )

  const total = users?.meta?.total ?? 0
  const rangeStart = total === 0 ? 0 : (page - 1) * USERS_PER_PAGE + 1
  const rangeEnd = Math.min(total, page * USERS_PER_PAGE)
  const maxPage = Math.max(1, Math.ceil(total / USERS_PER_PAGE))

  // The role guard lives in AdminLayout (this page's shell) -- see
  // AdminLayout.tsx.
  return (
    <div>
      <ViewHeader icon={<ShieldCheck />} title="Administración" />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 lg:flex lg:gap-2.5 lg:flex-wrap mb-6">
        <StatCard
          compact
          icon={<Users />}
          label="Usuarios totales"
          value={String(stats?.total_users ?? '—')}
        />
        <StatCard compact icon={<UserCheck />} label="Activos" value={String(stats?.active_users ?? '—')} />
        <StatCard
          compact
          icon={<UserPlus />}
          label="Nuevos últimos 7 días"
          value={String(stats?.new_users_last_7_days ?? '—')}
        />
        <StatCard compact icon={<GoogleIcon />} label="Con Google" value={String(stats?.google_users ?? '—')} />
        <StatCard
          compact
          icon={<UserX />}
          label="Inactivos 30+ días"
          value={String(stats?.inactive_users_30d ?? '—')}
          valueClassName={
            stats && stats.inactive_users_30d > 0 ? 'text-[color:var(--nl-warning-ink)]' : undefined
          }
        />
        <StatCard
          compact
          icon={<Building2 />}
          label="Cuentas creadas"
          value={String(stats?.total_accounts ?? '—')}
        />
        <StatCard
          compact
          icon={<ArrowLeftRight />}
          label="Transacciones"
          value={String(stats?.total_transactions ?? '—')}
        />
        <StatCard
          compact
          icon={<Coins />}
          label="Deudas registradas"
          value={String(stats?.total_debts ?? '—')}
        />
        <StatCard compact icon={<Bot />} label="Consultas IA hoy" value={String(stats?.ai_queries_today ?? '—')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-card border border-border rounded-md p-5">
          <div className="flex items-center gap-2 text-[15px] font-medium mb-4">
            <Activity size={15} className="text-muted-foreground" />
            Adopción de funciones
          </div>
          <AdoptionRow
            label="Con al menos 1 cuenta"
            count={stats?.users_with_accounts ?? 0}
            total={stats?.total_users ?? 0}
          />
          <AdoptionRow
            label="Con al menos 1 deuda"
            count={stats?.users_with_debts ?? 0}
            total={stats?.total_users ?? 0}
          />
          <AdoptionRow
            label="Con al menos 1 recurrente"
            count={stats?.users_with_recurring ?? 0}
            total={stats?.total_users ?? 0}
          />
        </div>

        <div className="bg-card border border-border rounded-md p-5">
          <div className="flex items-center gap-2 text-[15px] font-medium mb-4">
            <TrendingUp size={15} className="text-muted-foreground" />
            Altas de usuarios (14 días)
          </div>
          {stats && stats.signups_last_14_days.every((d) => d.count === 0) ? (
            <EmptyState>Sin altas nuevas en los últimos 14 días.</EmptyState>
          ) : (
            <SimpleBars
              height={140}
              showValues
              bars={(stats?.signups_last_14_days ?? []).map((d) => ({
                label: new Date(d.date).toLocaleDateString('es-MX', { day: 'numeric', timeZone: 'UTC' }),
                value: d.count,
              }))}
            />
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-md p-5">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2 text-[15px] font-medium">
            <Users size={15} className="text-muted-foreground" />
            Usuarios
          </div>
          <div className="relative w-full sm:w-[260px]">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar por nombre o correo..."
              className={`${selectClass} h-9 w-full pl-8`}
            />
          </div>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando...</p>
        ) : (users?.items.length ?? 0) === 0 ? (
          <EmptyState>{search ? 'Sin resultados para tu búsqueda.' : 'Sin usuarios.'}</EmptyState>
        ) : (
          <>
            <div className="hidden lg:grid grid-cols-[1.1fr_75px_85px_60px_70px_65px_85px_75px_75px] gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              <span>Usuario</span>
              <span>Registrado</span>
              <span>Última conexión</span>
              <span className="text-right">Cuentas</span>
              <span className="text-right">Transac.</span>
              <span>Salud</span>
              <span>Rol</span>
              <span>Estado</span>
              <span className="text-right">Acción</span>
            </div>
            {users?.items.map((u) => (
              <UserRow key={u.id} user={u} isSelf={u.id === currentUser?.id} />
            ))}
            <div className="flex justify-between items-center mt-3.5 text-xs text-muted-foreground">
              <span>
                Mostrando {rangeStart}–{rangeEnd} de {total}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="flex items-center gap-1 rounded px-3 py-1.5 border border-border disabled:opacity-40"
                >
                  <ChevronLeft size={13} />
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={page >= maxPage}
                  onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
                  className="flex items-center gap-1 rounded px-3 py-1.5 border border-border disabled:opacity-40"
                >
                  Siguiente
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="bg-card border border-border rounded-md p-5 mt-4">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2 text-[15px] font-medium">
            <MessageSquare size={15} className="text-muted-foreground" />
            Feedback
            {!!stats?.feedback_new_count && (
              <SoftBadge severity="blue">{stats.feedback_new_count} nuevo{stats.feedback_new_count === 1 ? '' : 's'}</SoftBadge>
            )}
          </div>
          <Select
            value={feedbackFilter || 'all'}
            onValueChange={(v) => setFeedbackFilter(v === 'all' ? '' : ((v as FeedbackStatus) ?? ''))}
          >
            <SelectTrigger className="h-8 w-[170px]">
              <SelectValue>
                {(v: FeedbackStatus | 'all') => (v === 'all' ? 'Todos los estados' : FEEDBACK_STATUS_LABELS[v])}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              {(Object.keys(FEEDBACK_STATUS_LABELS) as FeedbackStatus[]).map((status) => (
                <SelectItem key={status} value={status}>
                  {FEEDBACK_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {feedbackLoading ? (
          <p className="text-sm text-muted-foreground">Cargando...</p>
        ) : (feedbackItems?.length ?? 0) === 0 ? (
          <EmptyState>Sin feedback todavía.</EmptyState>
        ) : (
          <>
            <div className="hidden lg:grid grid-cols-[100px_1fr_1.4fr_120px_140px] gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              <span>Tipo</span>
              <span>Usuario</span>
              <span>Mensaje</span>
              <span>Fecha</span>
              <span className="text-right">Estado</span>
            </div>
            {feedbackItems?.map((item) => (
              <FeedbackRow key={item.id} item={item} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
