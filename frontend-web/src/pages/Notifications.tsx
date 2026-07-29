import { Bell, CreditCard, FileText, Lightbulb, PiggyBank } from 'lucide-react'
import { HelpSection, HelpTip } from '@/components/nl/Help'
import { SoftBadge, ViewHeader } from '@/components/nl/primitives'
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from '@/hooks/useNotifications'
import type { Notification, NotificationType } from '@/types'

const TYPE_META: Record<NotificationType, { icon: React.ReactNode; severity: 'accent' | 'danger' | 'warning' | 'violet' }> = {
  report_ready: { icon: <FileText size={14} />, severity: 'violet' },
  insight_generated: { icon: <Lightbulb size={14} />, severity: 'accent' },
  insight_reviewed: { icon: <Lightbulb size={14} />, severity: 'accent' },
  debt_alert: { icon: <CreditCard size={14} />, severity: 'danger' },
  budget_alert: { icon: <PiggyBank size={14} />, severity: 'warning' },
  tdc_due: { icon: <CreditCard size={14} />, severity: 'warning' },
  pending_payment: { icon: <Bell size={14} />, severity: 'warning' },
  pending_payment_reminder: { icon: <Bell size={14} />, severity: 'warning' },
  subscription_alert: { icon: <Bell size={14} />, severity: 'warning' },
  loan_overdue: { icon: <CreditCard size={14} />, severity: 'danger' },
}

function timeAgo(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'ahora'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  return `hace ${Math.floor(hours / 24)} d`
}

function NotificationRow({ notification }: { notification: Notification }) {
  const markRead = useMarkNotificationRead()
  const meta = TYPE_META[notification.type]

  return (
    <div
      onClick={() => !notification.is_read && markRead.mutate(notification.id)}
      className="flex items-start gap-3 px-4.5 py-4 border-t border-border first:border-0 cursor-pointer"
      style={{ background: notification.is_read ? 'transparent' : 'var(--nl-bg-hover)' }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
        style={{ background: notification.is_read ? 'transparent' : 'var(--nl-accent)' }}
      />
      <span
        className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
        style={{
          background: `var(--nl-${meta.severity}-soft-bg, var(--nl-bg-track))`,
          color: `var(--nl-${meta.severity}-ink, var(--nl-${meta.severity}))`,
        }}
      >
        {meta.icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium">{notification.title}</p>
        {notification.body && <p className="text-xs text-muted-foreground mt-0.5">{notification.body}</p>}
      </div>
      <span className="text-[11px] text-muted-foreground whitespace-nowrap">
        {timeAgo(notification.created_at)}
      </span>
    </div>
  )
}

function NotificationsHelp() {
  return (
    <>
      <HelpSection heading="Qué es esta pantalla">
        <p>
          Todos los avisos que te ha generado la app: reportes listos, insights nuevos, alertas de
          presupuesto o deuda, tarjetas por vencer y recordatorios de pagos pendientes.
        </p>
      </HelpSection>
      <HelpSection heading="Leer notificaciones">
        <p>
          Un punto de color marca lo que no has leído. Click en una notificación la marca como leída;
          "Marcar todo como leído" lo hace de una vez para todas.
        </p>
      </HelpSection>
      <HelpTip>
        El icono y el color de cada notificación indican su tipo (deuda, presupuesto, reporte, insight) —
        no hace falta abrirla para saber de qué se trata.
      </HelpTip>
    </>
  )
}

export function Notifications() {
  const { data, isLoading } = useNotifications(1, 50)
  const markAllRead = useMarkAllNotificationsRead()

  return (
    <div>
      <ViewHeader
        icon={<Bell />}
        title="Notificaciones"
        help={<NotificationsHelp />}
        tourKey="notifications"
        actions={
          <button
            type="button"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
            data-tour="notifications:mark-all"
            className="rounded px-3.5 py-1.5 text-[13px] border border-border text-muted-foreground hover:text-foreground"
          >
            Marcar todo como leído
          </button>
        }
      />
      <div className="bg-card border border-border rounded-md overflow-hidden" data-tour="notifications:list">
        {isLoading ? (
          <p className="text-sm text-muted-foreground p-6">Cargando...</p>
        ) : !data || data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground p-6 text-center">Sin notificaciones.</p>
        ) : (
          data.items.map((n) => <NotificationRow key={n.id} notification={n} />)
        )}
      </div>
      {data && data.meta && data.meta.total > 0 && (
        <div className="mt-3 flex justify-end">
          <SoftBadge severity="accent">{data.meta.total} en total</SoftBadge>
        </div>
      )}
    </div>
  )
}
