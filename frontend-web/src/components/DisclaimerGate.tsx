import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DisclaimerContent } from '@/components/DisclaimerContent'
import { useAcceptDisclaimer, useLogout } from '@/hooks/useAuth'
import { apiErrorMessage } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'

/** Blocks the ENTIRE app (mounted once in App.tsx, like ConfirmDialogHost)
 * for any user whose account already exists but whose
 * `accepted_disclaimer_version` doesn't match the current version --
 * accounts created before this feature, or after a real update to the
 * disclaimer. It has no X and doesn't close on click-outside/Escape (Dialog
 * stays controlled at open=true without releasing it from onOpenChange) --
 * the only two ways out are the buttons below: accept, or log out. If the
 * user logs out without accepting, the next time they sign in they'll run
 * into this same gate (the state lives in the backend, not in this
 * component). */
export function DisclaimerGate() {
  const { t } = useTranslation('common')
  const user = useAuthStore((s) => s.user)
  const acceptDisclaimer = useAcceptDisclaimer()
  const logout = useLogout()

  const needsAcceptance =
    !!user && user.accepted_disclaimer_version !== user.current_disclaimer_version

  if (!needsAcceptance) return null

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('disclaimerGate.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-[12.5px] text-muted-foreground -mt-2">
          {t('disclaimerGate.intro')}
        </p>
        <div className="overflow-y-auto pr-1 flex-1 min-h-0">
          <DisclaimerContent />
        </div>
        {acceptDisclaimer.isError && (
          <p className="text-[12px] text-destructive">{apiErrorMessage(acceptDisclaimer.error)}</p>
        )}
        <div className="flex gap-2 pt-1 flex-shrink-0">
          <button
            type="button"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="flex-1 rounded-md border border-border py-2 text-[13px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {t('disclaimerGate.logout')}
          </button>
          <button
            type="button"
            onClick={() => acceptDisclaimer.mutate()}
            disabled={acceptDisclaimer.isPending}
            className="flex-1 rounded-md py-2 text-[13px] font-medium disabled:opacity-50"
            style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
          >
            {acceptDisclaimer.isPending ? t('disclaimerGate.saving') : t('disclaimerGate.accept')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
