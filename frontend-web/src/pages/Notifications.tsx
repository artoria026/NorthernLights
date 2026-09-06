import { Bell, CreditCard, FileText, Lightbulb, PiggyBank } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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

function timeAgo(isoDate: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return t('notifications.timeAgo.now')
  if (minutes < 60) return t('notifications.timeAgo.minutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('notifications.timeAgo.hours', { count: hours })
  return t('notifications.timeAgo.days', { count: Math.floor(hours / 24) })
}

function NotificationRow({ notification }: { notification: Notification }) {
  const { t } = useTranslation('pages')
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
        {timeAgo(notification.created_at, t)}
      </span>
    </div>
  )
}

function NotificationsHelp() {
  const { t } = useTranslation('pages')
  return (
    <>
      <HelpSection heading={t('notifications.help.whatIsThisScreen.heading')}>
        <p>{t('notifications.help.whatIsThisScreen.body')}</p>
      </HelpSection>
      <HelpSection heading={t('notifications.help.readingNotifications.heading')}>
        <p>{t('notifications.help.readingNotifications.body')}</p>
      </HelpSection>
      <HelpTip>{t('notifications.help.tip')}</HelpTip>
    </>
  )
}

export function Notifications() {
  const { t } = useTranslation('pages')
  const { data, isLoading } = useNotifications(1, 50)
  const markAllRead = useMarkAllNotificationsRead()

  return (
    <div>
      <ViewHeader
        icon={<Bell />}
        title={t('notifications.title')}
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
            {t('notifications.markAllRead')}
          </button>
        }
      />
      <div className="bg-card border border-border rounded-md overflow-hidden" data-tour="notifications:list">
        {isLoading ? (
          <p className="text-sm text-muted-foreground p-6">{t('notifications.loading')}</p>
        ) : !data || data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground p-6 text-center">{t('notifications.empty')}</p>
        ) : (
          data.items.map((n) => <NotificationRow key={n.id} notification={n} />)
        )}
      </div>
      {data && data.meta && data.meta.total > 0 && (
        <div className="mt-3 flex justify-end" data-tour="notifications:total-badge">
          <SoftBadge severity="accent">{t('notifications.totalBadge', { total: data.meta.total })}</SoftBadge>
        </div>
      )}
    </div>
  )
}
