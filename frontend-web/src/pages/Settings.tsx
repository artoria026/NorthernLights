import { Check, FileText, LogOut, Settings as SettingsIcon, ShieldCheck, Trash2, X } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PasswordInput } from '@/components/ui/password-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DisclaimerContent } from '@/components/DisclaimerContent'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { HelpSection, HelpTip } from '@/components/nl/Help'
import { ToggleSwitch, ViewHeader } from '@/components/nl/primitives'
import {
  useChangePassword,
  useDeleteAccount,
  useLogout,
  useSyncedTheme,
  useUnlinkGoogle,
  useUpdateProfile,
  useUpdateSettings,
} from '@/hooks/useAuth'
import { type DataCategory, useEraseData } from '@/hooks/useData'
import { apiErrorMessage } from '@/services/api'
import { fileToNormalizedDataUrl, validateImageFile } from '@/lib/image'
import { selectClass } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { useConfirmStore } from '@/stores/confirmStore'
import type { PayCycle, Theme } from '@/types'

function SettingsCard({
  title,
  children,
  dataTour,
}: {
  title: string
  children: React.ReactNode
  dataTour?: string
}) {
  return (
    <div className="bg-card border border-border rounded-md p-5" data-tour={dataTour}>
      <div className="text-[15px] font-semibold mb-4">{title}</div>
      {children}
    </div>
  )
}

function AvatarField() {
  const { t } = useTranslation('pages')
  const user = useAuthStore((s) => s.user)
  const updateProfile = useUpdateProfile()
  const [error, setError] = useState('')

  async function handleFile(file: File | undefined) {
    if (!file || !user) return
    setError('')
    const validationError = validateImageFile(file)
    if (validationError) {
      setError(validationError)
      return
    }
    try {
      const dataUrl = await fileToNormalizedDataUrl(file)
      await updateProfile.mutateAsync({ name: user.name, avatar_url: dataUrl })
    } catch {
      setError(t('settings.profile.avatar.error'))
    }
  }

  async function handleRemove() {
    if (!user) return
    await updateProfile.mutateAsync({ name: user.name, avatar_url: null })
  }

  return (
    <div className="flex items-center gap-3 mb-4">
      {user?.avatar_url ? (
        <img src={user.avatar_url} alt="" className="w-[52px] h-[52px] rounded-full object-cover" />
      ) : (
        <div
          className="w-[52px] h-[52px] rounded-full flex items-center justify-center text-xl font-semibold"
          style={{ background: 'var(--nl-bg-track)' }}
        >
          {user?.name.slice(0, 2).toUpperCase() || '?'}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <label className="text-[12px] text-muted-foreground hover:text-foreground cursor-pointer underline underline-offset-2">
            {user?.avatar_url ? t('settings.profile.avatar.change') : t('settings.profile.avatar.upload')}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                void handleFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>
          {user?.avatar_url && (
            <button
              type="button"
              onClick={handleRemove}
              className="text-[12px] text-muted-foreground hover:text-destructive"
            >
              {t('settings.profile.avatar.remove')}
            </button>
          )}
        </div>
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>
    </div>
  )
}

function ProfileCard() {
  const { t } = useTranslation('pages')
  const user = useAuthStore((s) => s.user)
  const updateProfile = useUpdateProfile()
  const changePassword = useChangePassword()
  const [name, setName] = useState(user?.name ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')

  async function handleSaveName(event: FormEvent) {
    event.preventDefault()
    try {
      await updateProfile.mutateAsync({ name, avatar_url: user?.avatar_url })
    } catch {
      // error shown below
    }
  }

  async function handleChangePassword(event: FormEvent) {
    event.preventDefault()
    try {
      await changePassword.mutateAsync({ current_password: currentPassword, new_password: newPassword })
      setCurrentPassword('')
      setNewPassword('')
    } catch {
      // error shown below
    }
  }

  return (
    <SettingsCard title={t('settings.profile.title')} dataTour="settings:profile">
      <AvatarField />
      <form onSubmit={handleSaveName} className="flex flex-col gap-3 max-w-sm">
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-muted-foreground">{t('settings.profile.fullName')}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`${selectClass} h-9 w-full`}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-muted-foreground">{t('settings.profile.email')}</label>
          <input value={user?.email ?? ''} disabled className={`${selectClass} h-9 w-full`} />
        </div>
        {updateProfile.isError && (
          <p className="text-xs text-destructive">{apiErrorMessage(updateProfile.error)}</p>
        )}
        <button
          type="submit"
          disabled={updateProfile.isPending}
          className="w-fit flex items-center gap-1.5 rounded px-4 py-2 text-[13px] font-medium"
          style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
        >
          <Check size={14} />
          {updateProfile.isPending ? t('settings.profile.saving') : t('settings.profile.saveChanges')}
        </button>
      </form>

      <div className="border-t border-border mt-5 pt-4 flex flex-col gap-3 max-w-sm">
        <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-muted-foreground">{t('settings.profile.currentPassword')}</label>
            <PasswordInput
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={`${selectClass} h-9 w-full`}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-muted-foreground">{t('settings.profile.newPassword')}</label>
            <PasswordInput
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={`${selectClass} h-9 w-full`}
            />
          </div>
          {changePassword.isError && (
            <p className="text-xs text-destructive">{apiErrorMessage(changePassword.error)}</p>
          )}
          {changePassword.isSuccess && (
            <p className="text-xs text-primary">{t('settings.profile.passwordUpdated')}</p>
          )}
          <button
            type="submit"
            disabled={changePassword.isPending}
            className="w-fit flex items-center gap-1.5 rounded px-4 py-2 text-[13px] border border-border text-muted-foreground hover:text-foreground"
          >
            <Check size={14} />
            {changePassword.isPending ? t('settings.profile.changingPassword') : t('settings.profile.changePassword')}
          </button>
        </form>
      </div>
    </SettingsCard>
  )
}

function SecurityCard() {
  const { t } = useTranslation('pages')
  return (
    <SettingsCard title={t('settings.security.title')}>
      <div className="flex items-center justify-between py-2">
        <span className="text-sm">{t('settings.security.twoFactor')}</span>
        <ToggleSwitch checked={false} onChange={() => {}} disabled />
      </div>
      <p className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-3 mt-2">
        {t('settings.security.comingSoon')}
      </p>
    </SettingsCard>
  )
}

const PAY_CYCLES: PayCycle[] = ['weekly', 'biweekly', 'monthly']

function payCycleLabel(t: (key: string) => string, cycle: PayCycle): string {
  return t(`settings.preferences.payCycleOptions.${cycle}`)
}

function themeLabel(t: (key: string) => string, theme: Theme): string {
  return t(`settings.preferences.themeOptions.${theme}`)
}

function NotificationsAndPreferencesCard() {
  const { t } = useTranslation('pages')
  const user = useAuthStore((s) => s.user)
  const updateSettings = useUpdateSettings()
  const { mode, setTheme, isPending: themePending } = useSyncedTheme()

  return (
    <SettingsCard title={t('settings.preferences.title')} dataTour="settings:preferences">
      <div className="flex flex-col">
        <div className="flex items-center justify-between py-3 border-b border-border">
          <span className="text-sm">{t('settings.preferences.theme')}</span>
          <Select value={mode} disabled={themePending} onValueChange={(v) => setTheme((v as Theme) ?? 'dark')}>
            <SelectTrigger className="h-8 w-auto">
              <SelectValue>{(v: Theme) => themeLabel(t, v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(['dark', 'light'] as Theme[]).map((theme) => (
                <SelectItem key={theme} value={theme}>
                  {themeLabel(t, theme)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between py-3 border-b border-border">
          <span className="text-sm">{t('settings.preferences.language')}</span>
          <LanguageSwitcher />
        </div>
        <div className="flex items-center justify-between py-3 border-b border-border">
          <div>
            <p className="text-sm">{t('settings.preferences.emailNotifications.label')}</p>
            <p className="text-xs text-muted-foreground">
              {t('settings.preferences.emailNotifications.description')}
            </p>
          </div>
          <ToggleSwitch
            checked={user?.email_notifications ?? true}
            disabled={updateSettings.isPending}
            onChange={(checked) => updateSettings.mutate({ email_notifications: checked })}
          />
        </div>
        <div className="flex items-center justify-between py-3 border-b border-border">
          <div>
            <p className="text-sm">{t('settings.preferences.pushNotifications.label')}</p>
            <p className="text-xs text-muted-foreground">
              {t('settings.preferences.pushNotifications.description')}
            </p>
          </div>
          <ToggleSwitch
            checked={user?.push_notifications ?? true}
            disabled={updateSettings.isPending}
            onChange={(checked) => updateSettings.mutate({ push_notifications: checked })}
          />
        </div>
        <div className="flex items-center justify-between py-3">
          <span className="text-sm">{t('settings.preferences.payCycle')}</span>
          <Select
            value={user?.pay_cycle ?? 'monthly'}
            disabled={updateSettings.isPending}
            onValueChange={(v) => updateSettings.mutate({ pay_cycle: (v as PayCycle) ?? 'monthly' })}
          >
            <SelectTrigger className="h-8 w-auto">
              <SelectValue>{(v: PayCycle) => payCycleLabel(t, v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PAY_CYCLES.map((cycle) => (
                <SelectItem key={cycle} value={cycle}>
                  {payCycleLabel(t, cycle)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {updateSettings.isError && (
        <p className="text-xs text-destructive mt-2">{apiErrorMessage(updateSettings.error)}</p>
      )}
    </SettingsCard>
  )
}

function DebtTroubleCard() {
  const { t } = useTranslation('pages')
  const user = useAuthStore((s) => s.user)
  const updateSettings = useUpdateSettings()

  return (
    <SettingsCard title={t('settings.debtTrouble.title')} dataTour="settings:debt-trouble">
      <div className="flex items-center justify-between py-1">
        <div className="pr-3">
          <p className="text-sm">{t('settings.debtTrouble.label')}</p>
          <p className="text-xs text-muted-foreground">{t('settings.debtTrouble.description')}</p>
        </div>
        <ToggleSwitch
          checked={user?.debt_trouble_mode ?? false}
          disabled={updateSettings.isPending}
          onChange={(checked) => updateSettings.mutate({ debt_trouble_mode: checked })}
        />
      </div>
      {updateSettings.isError && (
        <p className="text-xs text-destructive mt-2">{apiErrorMessage(updateSettings.error)}</p>
      )}
    </SettingsCard>
  )
}

/** Used to live as a separate shield icon in AppSidebar (mobile header +
 * sidebar) -- moved here so there isn't a navigation button floating
 * outside the app's normal flow. Only renders for admins; the real guard
 * is still the backend + AdminLayout, this is just the entry point. */
function AdminAccessCard() {
  const { t } = useTranslation('pages')
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()

  if (user?.role !== 'admin') return null

  return (
    <SettingsCard title={t('settings.admin.title')}>
      <p className="text-sm text-muted-foreground mb-3">{t('settings.admin.description')}</p>
      <button
        type="button"
        onClick={() => navigate('/admin')}
        className="flex items-center gap-1.5 rounded px-3.5 py-2 text-[13px] font-medium"
        style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
      >
        <ShieldCheck size={14} />
        {t('settings.admin.goToPanel')}
      </button>
    </SettingsCard>
  )
}

function ConnectedAccountsCard() {
  const { t } = useTranslation('pages')
  const user = useAuthStore((s) => s.user)
  const unlinkGoogle = useUnlinkGoogle()
  const isGoogleLinked = user?.auth_provider === 'google'

  return (
    <SettingsCard title={t('settings.connectedAccounts.title')} dataTour="settings:connected-accounts">
      <div className="flex items-center gap-2.5 py-2.5">
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" className="flex-shrink-0">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.9 32.6 29.4 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.6 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.3 0 10.1-2 13.7-5.3l-6.3-5.3C29.4 35.4 26.8 36 24 36c-5.3 0-9.9-3.4-11.3-8.1l-6.5 5C9.6 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.1-3.3 5.6-6.2 7.1l6.3 5.3C39.9 37.5 44 31.7 44 24c0-1.3-.1-2.7-.4-3.5z" />
        </svg>
        <span className="text-sm flex-1">{t('settings.connectedAccounts.google')}</span>
        {isGoogleLinked ? (
          <button
            type="button"
            onClick={() => unlinkGoogle.mutate()}
            disabled={unlinkGoogle.isPending}
            className="rounded-full px-2.5 py-0.5 text-[11px] border border-border text-muted-foreground hover:text-destructive"
          >
            {t('settings.connectedAccounts.unlink')}
          </button>
        ) : (
          <span
            className="rounded-full px-2.5 py-0.5 text-[10px]"
            style={{ background: 'var(--nl-bg-track)', color: 'var(--nl-text-muted)' }}
          >
            {t('settings.connectedAccounts.notLinked')}
          </span>
        )}
      </div>
      {!isGoogleLinked && (
        <p className="text-xs text-muted-foreground">{t('settings.connectedAccounts.linkHint')}</p>
      )}
      {unlinkGoogle.isError && (
        <p className="text-xs text-destructive mt-1">{apiErrorMessage(unlinkGoogle.error)}</p>
      )}
    </SettingsCard>
  )
}

/** Read-only -- there's nothing to "accept" again here, if you got to see
 * this button it's because DisclaimerGate already let you through. It's
 * there to reread the notice whenever you want, without having to wait
 * for it to change version. */
function PrivacyCard() {
  const { t } = useTranslation('pages')
  const [open, setOpen] = useState(false)
  return (
    <SettingsCard title={t('settings.privacy.title')}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-1.5 rounded-md border border-border py-2 text-sm hover:bg-muted"
      >
        <FileText size={14} />
        {t('settings.privacy.viewNotice')}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('settings.privacy.noticeTitle')}</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto pr-1">
            <DisclaimerContent />
          </div>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  )
}

const GRANULAR_CATEGORIES: DataCategory[] = [
  'transactions',
  'debts',
  'recurring',
  'budgets',
  'insights',
  'reports',
  'notifications',
  'chat',
  'categories',
  'accounts',
]

function categoryLabel(t: (key: string) => string, category: DataCategory): string {
  return t(`settings.dataManagement.categories.${category}`)
}

function DataManagementCard() {
  const { t, i18n } = useTranslation('pages')
  const eraseData = useEraseData()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [selected, setSelected] = useState<Set<DataCategory>>(new Set())
  const [result, setResult] = useState<DataCategory[] | null>(null)

  function toggle(category: DataCategory) {
    setResult(null)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  async function run(categories: DataCategory[]) {
    setResult(null)
    try {
      const res = await eraseData.mutateAsync({ categories, password: password || undefined })
      setResult(res.erased)
      setSelected(new Set())
    } catch {
      // error shown below
    }
  }

  return (
    <SettingsCard title={t('settings.dataManagement.title')} dataTour="settings:data">
      <p className="text-xs text-muted-foreground mb-3">{t('settings.dataManagement.description')}</p>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded px-4 py-2 text-[13px] border border-destructive/40 text-destructive hover:bg-destructive/10"
        >
          <Trash2 size={14} />
          {t('settings.dataManagement.manage')}
        </button>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5 max-w-sm">
            <label className="text-[11px] text-muted-foreground">
              {t('settings.dataManagement.passwordLabel')}
            </label>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${selectClass} h-9 w-full`}
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wide">
              {t('settings.dataManagement.quickOptions')}
            </span>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                disabled={eraseData.isPending}
                onClick={() => run(GRANULAR_CATEGORIES.filter((c) => c !== 'accounts'))}
                className="flex items-center gap-1.5 rounded px-3.5 py-2 text-[13px] border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                <Trash2 size={14} />
                {t('settings.dataManagement.eraseAllExceptAccounts')}
              </button>
              <button
                type="button"
                disabled={eraseData.isPending}
                onClick={() => run(GRANULAR_CATEGORIES)}
                className="flex items-center gap-1.5 rounded px-3.5 py-2 text-[13px] font-medium disabled:opacity-50"
                style={{ background: 'var(--nl-danger)', color: '#fff' }}
              >
                <Trash2 size={14} />
                {t('settings.dataManagement.eraseAllIncludingAccounts')}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-2 border-t border-border">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wide">
              {t('settings.dataManagement.selective')}
            </span>
            <div className="flex flex-col gap-1.5">
              {GRANULAR_CATEGORIES.map((category) => (
                <label key={category} className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={selected.has(category)}
                    onChange={() => toggle(category)}
                  />
                  {categoryLabel(t, category)}
                </label>
              ))}
            </div>
            <button
              type="button"
              disabled={eraseData.isPending || selected.size === 0}
              onClick={() => run(Array.from(selected))}
              className="w-fit flex items-center gap-1.5 rounded px-3.5 py-2 text-[13px] border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-40"
            >
              <Trash2 size={14} />
              {eraseData.isPending
                ? t('settings.dataManagement.erasing')
                : t('settings.dataManagement.eraseSelected', { count: selected.size })}
            </button>
          </div>

          {eraseData.isError && (
            <p className="text-xs text-destructive">{apiErrorMessage(eraseData.error)}</p>
          )}
          {result && (
            <p className="text-xs" style={{ color: 'var(--nl-accent-ink)' }}>
              {t('settings.dataManagement.deleteSummary', {
                list: new Intl.ListFormat(i18n.language, { style: 'long', type: 'conjunction' }).format(
                  result.map((c) => categoryLabel(t, c)),
                ),
              })}
            </p>
          )}

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-fit text-xs text-muted-foreground hover:text-foreground"
          >
            {t('settings.dataManagement.close')}
          </button>
        </div>
      )}
    </SettingsCard>
  )
}

function DeleteAccountCard() {
  const { t } = useTranslation('pages')
  const navigate = useNavigate()
  const deleteAccount = useDeleteAccount()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')

  async function handleDelete(event: FormEvent) {
    event.preventDefault()
    try {
      await deleteAccount.mutateAsync(password || undefined)
      navigate('/login')
    } catch {
      // error shown below
    }
  }

  return (
    <SettingsCard title={t('settings.deleteAccount.title')} dataTour="settings:delete-account">
      <p className="text-xs text-muted-foreground mb-3">{t('settings.deleteAccount.description')}</p>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded px-4 py-2 text-[13px] border border-destructive/40 text-destructive hover:bg-destructive/10"
        >
          <Trash2 size={14} />
          {t('settings.deleteAccount.trigger')}
        </button>
      ) : (
        <form onSubmit={handleDelete} className="flex flex-col gap-3 max-w-sm">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-muted-foreground">
              {t('settings.deleteAccount.passwordLabel')}
            </label>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${selectClass} h-9 w-full`}
            />
          </div>
          {deleteAccount.isError && (
            <p className="text-xs text-destructive">{apiErrorMessage(deleteAccount.error)}</p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex items-center gap-1.5 rounded px-4 py-2 text-[13px] border border-border text-muted-foreground hover:text-foreground"
            >
              <X size={14} />
              {t('settings.deleteAccount.cancel')}
            </button>
            <button
              type="submit"
              disabled={deleteAccount.isPending}
              className="flex items-center gap-1.5 rounded px-4 py-2 text-[13px] font-medium disabled:opacity-60"
              style={{ background: 'var(--nl-danger)', color: '#fff' }}
            >
              <Trash2 size={14} />
              {deleteAccount.isPending ? t('settings.deleteAccount.deleting') : t('settings.deleteAccount.confirm')}
            </button>
          </div>
        </form>
      )}
    </SettingsCard>
  )
}

function SessionCard() {
  const { t } = useTranslation('pages')
  const navigate = useNavigate()
  const logout = useLogout()
  const confirm = useConfirmStore((s) => s.ask)

  async function handleLogout() {
    const ok = await confirm({
      title: t('settings.session.logoutConfirm.title'),
      message: t('settings.session.logoutConfirm.message'),
      confirmLabel: t('settings.session.logoutConfirm.confirmLabel'),
      variant: 'danger',
      icon: LogOut,
    })
    if (!ok) return
    await logout.mutateAsync()
    navigate('/login')
  }

  return (
    <SettingsCard title={t('settings.session.title')}>
      <button
        type="button"
        disabled={logout.isPending}
        onClick={handleLogout}
        className="w-full flex items-center justify-center gap-2 rounded-md border border-destructive/40 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
      >
        <LogOut size={15} strokeWidth={2} />
        {logout.isPending ? t('settings.session.loggingOut') : t('settings.session.logout')}
      </button>
    </SettingsCard>
  )
}

function SettingsHelp() {
  const { t } = useTranslation('pages')
  return (
    <>
      <HelpSection heading={t('settings.help.whatIsThisScreen.heading')}>
        <p>{t('settings.help.whatIsThisScreen.body')}</p>
      </HelpSection>
      <HelpSection heading={t('settings.help.profilePhoto.heading')}>
        <p>{t('settings.help.profilePhoto.body')}</p>
      </HelpSection>
      <HelpSection heading={t('settings.help.themeNotificationsPayCycle.heading')}>
        <p>{t('settings.help.themeNotificationsPayCycle.body')}</p>
      </HelpSection>
      <HelpSection heading={t('settings.help.debtTrouble.heading')}>
        <p>{t('settings.help.debtTrouble.body')}</p>
      </HelpSection>
      <HelpSection heading={t('settings.help.googleAccount.heading')}>
        <p>{t('settings.help.googleAccount.body')}</p>
      </HelpSection>
      <HelpSection heading={t('settings.help.eraseData.heading')}>
        <p>{t('settings.help.eraseData.body')}</p>
      </HelpSection>
      <HelpTip>{t('settings.help.tip')}</HelpTip>
    </>
  )
}

export function Settings() {
  const { t } = useTranslation('pages')
  return (
    <div>
      <ViewHeader
        icon={<SettingsIcon />}
        title={t('settings.title')}
        help={<SettingsHelp />}
        tourKey="settings"
      />
      <div>
        {/* Each column deliberately pairs cards of similar height (Profile
            is the tallest card of all, that's why it goes alone with
            Security, which is the shortest) -- last time there was a huge
            gap when one column had much more content than the other. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          <div className="flex flex-col gap-5">
            <ProfileCard />
            <SecurityCard />
          </div>
          <div className="flex flex-col gap-5">
            <NotificationsAndPreferencesCard />
            <ConnectedAccountsCard />
            <PrivacyCard />
          </div>
        </div>

        <div className="mt-8">
          <div className="text-[11px] tracking-wide text-muted-foreground font-semibold mb-3">
            {t('settings.sections.functions')}
          </div>
          <div className="flex flex-col gap-5">
            <DebtTroubleCard />
            <AdminAccessCard />
          </div>
        </div>

        {/* Exit zone -- from less to more irreversible. Session and Erase
            data are similar in height (collapsed), that's why they're
            paired; Delete account goes alone at full width, deliberately
            separated from the rest -- it's the screen's only action with
            no going back. */}
        <div className="border-t border-border mt-8 pt-6 grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          <DataManagementCard />
          <SessionCard />
        </div>
        <div className="mt-5">
          <DeleteAccountCard />
        </div>
      </div>
    </div>
  )
}
