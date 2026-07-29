import { Bug, Lightbulb, MessageSquare, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { HelpSection, HelpTip } from '@/components/nl/Help'
import { EmptyState, SoftBadge, StatCard, ViewHeader } from '@/components/nl/primitives'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { type AdminUser, useAdminStats, useAdminUsers, useSetUserActive, useSetUserRole } from '@/hooks/useAdmin'
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

function UserRow({ user, isSelf }: { user: AdminUser; isSelf: boolean }) {
  const setActive = useSetUserActive()
  const setRole = useSetUserRole()
  const confirm = useConfirmStore((s) => s.ask)
  const pushToast = useUiStore((s) => s.pushToast)
  const busy = setActive.isPending || setRole.isPending

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
          className="rounded px-2 py-1 text-[11px] border border-border text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          {user.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}
        </button>
      )}
      <button
        type="button"
        disabled={busy || isSelf}
        title={isSelf ? 'No puedes desactivar tu propia cuenta' : undefined}
        onClick={toggleActive}
        className="rounded px-2 py-1 text-[11px] border border-border text-destructive hover:opacity-80 disabled:opacity-40"
      >
        {user.is_active ? 'Desactivar' : 'Reactivar'}
      </button>
    </>
  )

  return (
    <>
      {/* Fila de tabla -- solo lg+ */}
      <div className="hidden lg:grid grid-cols-[1.6fr_1fr_90px_100px_110px_170px] gap-2 items-center py-3 border-t border-border first:border-0 text-[13px]">
        <div className="min-w-0">
          <div className="font-medium truncate">
            {user.name} {isSelf && <span className="text-muted-foreground">(tú)</span>}
          </div>
          <div className="text-muted-foreground text-[12px] truncate">{user.email}</div>
        </div>
        <span className="text-muted-foreground">{formatDate(user.created_at)}</span>
        <span className="text-right text-muted-foreground">{user.accounts_count}</span>
        <span className="text-right text-muted-foreground">{user.transactions_count}</span>
        <span>{roleBadge}</span>
        <span className="flex justify-end items-center gap-1.5">
          {statusBadge}
          {actionButtons}
        </span>
      </div>

      {/* Card -- solo mobile */}
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
        </div>
        <div className="text-[12px] text-muted-foreground">
          Desde {formatDate(user.created_at)} · {user.accounts_count} cuenta
          {user.accounts_count === 1 ? '' : 's'} · {user.transactions_count} transacc.
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">{actionButtons}</div>
      </div>
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

function FeedbackRow({ item }: { item: AdminFeedback }) {
  const updateStatus = useUpdateFeedbackStatus()
  const pushToast = useUiStore((s) => s.pushToast)
  const TypeIcon = item.type === 'bug' ? Bug : Lightbulb

  async function handleStatusChange(status: FeedbackStatus) {
    try {
      await updateStatus.mutateAsync({ id: item.id, status })
    } catch (error) {
      pushToast(apiErrorMessage(error), 'error')
    }
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

  return (
    <>
      {/* Fila de tabla -- solo lg+ */}
      <div className="hidden lg:grid grid-cols-[100px_1fr_1.4fr_120px_140px] gap-2 items-center py-3 border-t border-border first:border-0 text-[13px]">
        <span>{typeBadge}</span>
        <div className="min-w-0">
          <div className="font-medium truncate">{item.user_name}</div>
          <div className="text-muted-foreground text-[12px] truncate">{item.user_email}</div>
        </div>
        <p className="text-muted-foreground truncate" title={item.message}>
          {item.message}
        </p>
        <span className="text-muted-foreground text-[12px]">{formatDate(item.created_at)}</span>
        <span className="flex justify-end">{statusSelect}</span>
      </div>

      {/* Card -- solo mobile */}
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
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-muted-foreground">{formatDate(item.created_at)}</span>
          {statusSelect}
        </div>
      </div>
    </>
  )
}

function AdminHelp() {
  return (
    <>
      <HelpSection heading="Qué es esta pantalla">
        <p>
          Solo visible para administradores: uso general de la app (usuarios totales, activos, nuevos de
          la semana) y la lista completa de usuarios registrados.
        </p>
      </HelpSection>
      <HelpSection heading="Hacer/Quitar admin">
        <p>
          Da o quita permisos de administración a otro usuario. No puedes quitarte el rol a ti mismo desde
          aquí, para evitar quedarte sin acceso por accidente.
        </p>
      </HelpSection>
      <HelpSection heading="Desactivar / Reactivar">
        <p>
          Desactivar bloquea el inicio de sesión de ese usuario sin borrar sus datos — reversible en
          cualquier momento con "Reactivar". Tampoco puedes desactivar tu propia cuenta desde aquí.
        </p>
      </HelpSection>
      <HelpSection heading="Feedback de usuarios">
        <p>
          Bugs y sugerencias que los usuarios mandan desde el modal de "Novedades". Cambiá el estado con
          el selector de cada fila — <strong>Nuevo</strong> es lo que nadie revisó todavía,{' '}
          <strong>Leído</strong> lo viste pero no decidiste, <strong>Considerado</strong> lo vas a tener
          en cuenta y <strong>Descartado</strong> no se va a hacer. Por ahora el usuario no ve este
          estado, solo queda registrado acá.
        </p>
      </HelpSection>
      <HelpTip>
        Cuentas y Transacciones en la tabla son solo conteos de referencia — no puedes ver el detalle
        financiero de otro usuario desde este panel.
      </HelpTip>
    </>
  )
}

export function Admin() {
  const currentUser = useAuthStore((s) => s.user)
  const { data: stats } = useAdminStats()
  const { data: users, isLoading } = useAdminUsers(1, 100)
  const [feedbackFilter, setFeedbackFilter] = useState<FeedbackStatus | ''>('')
  const { data: feedbackItems, isLoading: feedbackLoading } = useAdminFeedback(
    feedbackFilter || undefined,
  )

  // El guard de rol vive en AdminLayout (shell de esta pagina) -- ver
  // AdminLayout.tsx.
  return (
    <div>
      <ViewHeader icon={<ShieldCheck />} title="Administración" help={<AdminHelp />} />

      <div className="grid grid-cols-2 gap-3 lg:flex lg:gap-5 lg:flex-wrap mb-6">
        <StatCard label="Usuarios totales" value={String(stats?.total_users ?? '—')} />
        <StatCard label="Activos" value={String(stats?.active_users ?? '—')} />
        <StatCard label="Nuevos últimos 7 días" value={String(stats?.new_users_last_7_days ?? '—')} />
        <StatCard label="Cuentas creadas" value={String(stats?.total_accounts ?? '—')} />
        <StatCard label="Transacciones" value={String(stats?.total_transactions ?? '—')} />
      </div>

      <div className="bg-card border border-border rounded-md p-5">
        <div className="text-[15px] font-medium mb-3">Usuarios</div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando...</p>
        ) : (users?.items.length ?? 0) === 0 ? (
          <EmptyState>Sin usuarios.</EmptyState>
        ) : (
          <>
            <div className="hidden lg:grid grid-cols-[1.6fr_1fr_90px_100px_110px_170px] gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              <span>Usuario</span>
              <span>Registrado</span>
              <span className="text-right">Cuentas</span>
              <span className="text-right">Transac.</span>
              <span>Rol</span>
              <span className="text-right">Estado / Acción</span>
            </div>
            {users?.items.map((u) => (
              <UserRow key={u.id} user={u} isSelf={u.id === currentUser?.id} />
            ))}
          </>
        )}
      </div>

      <div className="bg-card border border-border rounded-md p-5 mt-4">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2 text-[15px] font-medium">
            <MessageSquare size={15} className="text-muted-foreground" />
            Feedback
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
