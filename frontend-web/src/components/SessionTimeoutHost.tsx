import { Clock, LogOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useSessionTimeout } from '@/hooks/useSessionTimeout'

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Mounted once inside the signed-in routes (ProtectedRoute): runs the
 * inactivity clock and shows the "still there?" countdown. Can't be dismissed
 * by clicking outside or pressing Escape: only the two buttons answer it. */
export function SessionTimeoutHost() {
  const { t } = useTranslation('common')
  const { remainingSeconds, stayConnected, signOutNow } = useSessionTimeout()

  return (
    // Controlled with no way to close it from the outside: the answer is a button.
    <Dialog open={remainingSeconds !== null} onOpenChange={() => undefined}>
      {remainingSeconds !== null && (
        <DialogContent className="sm:max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock size={16} />
              {t('sessionTimeout.title')}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('sessionTimeout.message')}</p>
          <div
            className="text-center text-3xl font-light tabular-nums py-2"
            role="timer"
            aria-live="polite"
            aria-label={t('sessionTimeout.countdownLabel', { time: formatCountdown(remainingSeconds) })}
          >
            {formatCountdown(remainingSeconds)}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={signOutNow}
              className="flex items-center gap-1.5 rounded px-4 py-2 text-[13px] border border-border text-muted-foreground hover:text-foreground"
            >
              <LogOut size={14} />
              {t('sessionTimeout.signOut')}
            </button>
            <button
              type="button"
              autoFocus
              onClick={stayConnected}
              className="rounded px-4 py-2 text-[13px] font-medium"
              style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
            >
              {t('sessionTimeout.stay')}
            </button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}
