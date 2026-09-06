import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Rocket,
  ShieldCheck,
  Sparkles,
  User,
} from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DisclaimerContent } from '@/components/DisclaimerContent'
import { useLogin, useRegister, useUpdateSettings } from '@/hooks/useAuth'
import { LATEST_CHANGELOG_VERSION } from '@/lib/changelog'
import { apiErrorMessage } from '@/services/api'
import type { Locale } from '@/types'
import { AuthLayout, type AuthValueProp } from './AuthLayout'

function buildValueProps(t: (key: string) => string): AuthValueProp[] {
  return [
    {
      icon: Rocket,
      title: t('auth.register.valueProps.quickStart.title'),
      text: t('auth.register.valueProps.quickStart.text'),
    },
    {
      icon: ShieldCheck,
      title: t('auth.register.valueProps.privacy.title'),
      text: t('auth.register.valueProps.privacy.text'),
    },
    {
      icon: Sparkles,
      title: t('auth.register.valueProps.advisor.title'),
      text: t('auth.register.valueProps.advisor.text'),
    },
  ]
}

export function Register() {
  const { t, i18n } = useTranslation('pages')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [acceptDisclaimer, setAcceptDisclaimer] = useState(false)
  const [disclaimerOpen, setDisclaimerOpen] = useState(false)
  const navigate = useNavigate()
  const register = useRegister()
  const login = useLogin()
  const updateSettings = useUpdateSettings()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!acceptDisclaimer) return
    try {
      await register.mutateAsync({
        email,
        name,
        password,
        accept_disclaimer: true,
        locale: i18n.language as Locale,
      })
      await login.mutateAsync({ email, password })
      // Newly created account: hasn't seen any release yet, so there's no
      // point showing it "Novedades" with features it never used -- it's
      // marked as seen before navigating so ChangelogButton doesn't even
      // auto-open once (see last_seen_changelog_version).
      // With its own try/catch: if this fails, it shouldn't block sign-in
      // (register+login are already successful at this point).
      try {
        await updateSettings.mutateAsync({ last_seen_changelog_version: LATEST_CHANGELOG_VERSION })
      } catch {
        // no-op: worst case they see the changelog modal once
      }
      navigate('/')
    } catch {
      // the error is shown below
    }
  }

  const error = register.error ?? login.error
  const errorMessage = error ? apiErrorMessage(error) : null
  const isPending = register.isPending || login.isPending
  const valueProps = buildValueProps(t)

  return (
    <AuthLayout
      heroTitle={t('auth.register.heroTitle')}
      heroSubtitle={t('auth.register.heroSubtitle')}
      valueProps={valueProps}
    >
      <h2 className="text-[22px] font-semibold tracking-tight mb-1.5">
        {t('auth.register.title')}
      </h2>
      <p className="text-[13px] text-muted-foreground mb-7">{t('auth.register.subtitle')}</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="text-[12px] font-medium text-muted-foreground">
            {t('auth.register.nameLabel')}
          </label>
          <div className="relative">
            <User
              size={15}
              strokeWidth={2}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              id="name"
              type="text"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('auth.register.namePlaceholder')}
              className="w-full h-11 rounded-lg border border-border pl-9 pr-3 text-[14px] outline-none transition-colors focus:border-[var(--nl-accent)]"
              style={{ background: 'var(--nl-bg-input)' }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-[12px] font-medium text-muted-foreground">
            {t('auth.register.emailLabel')}
          </label>
          <div className="relative">
            <Mail
              size={15}
              strokeWidth={2}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('auth.register.emailPlaceholder')}
              className="w-full h-11 rounded-lg border border-border pl-9 pr-3 text-[14px] outline-none transition-colors focus:border-[var(--nl-accent)]"
              style={{ background: 'var(--nl-bg-input)' }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-[12px] font-medium text-muted-foreground">
            {t('auth.register.passwordLabel')}
          </label>
          <div className="relative">
            <Lock
              size={15}
              strokeWidth={2}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('auth.register.passwordPlaceholder')}
              className="w-full h-11 rounded-lg border border-border pl-9 pr-9 text-[14px] outline-none transition-colors focus:border-[var(--nl-accent)]"
              style={{ background: 'var(--nl-bg-input)' }}
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((v) => !v)}
              title={
                showPassword
                  ? t('auth.register.hidePasswordTitle')
                  : t('auth.register.showPasswordTitle')
              }
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        {errorMessage && (
          <div
            className="flex items-start gap-2 rounded-md px-3 py-2.5 text-[12.5px]"
            style={{ background: 'var(--nl-danger-soft-bg)', color: 'var(--nl-danger-ink)' }}
          >
            <AlertCircle size={14} strokeWidth={2} className="flex-shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <label className="flex items-start gap-2 text-[12.5px] text-muted-foreground select-none">
          <input
            type="checkbox"
            required
            checked={acceptDisclaimer}
            onChange={(e) => setAcceptDisclaimer(e.target.checked)}
            className="mt-0.5 flex-shrink-0"
          />
          <span>
            {t('auth.register.acceptDisclaimerPrefix')}{' '}
            <button
              type="button"
              onClick={() => setDisclaimerOpen(true)}
              className="font-medium underline hover:no-underline"
              style={{ color: 'var(--nl-accent-ink)' }}
            >
              {t('auth.register.privacyNotice')}
            </button>
            .
          </span>
        </label>

        <button
          type="submit"
          disabled={isPending || !acceptDisclaimer}
          className="group w-full h-11 rounded-lg text-[14px] font-medium transition-opacity hover:opacity-90 disabled:opacity-60 mt-1 flex items-center justify-center gap-1.5"
          style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
        >
          {isPending ? (
            t('auth.register.submitPending')
          ) : (
            <>
              {t('auth.register.submitCta')}
              <ArrowRight
                size={15}
                strokeWidth={2}
                className="transition-transform duration-200 group-hover:translate-x-1"
              />
            </>
          )}
        </button>

        <p className="text-[13px] text-center text-muted-foreground mt-2">
          {t('auth.register.haveAccountText')}{' '}
          <Link
            to="/login"
            viewTransition
            className="font-medium"
            style={{ color: 'var(--nl-accent-ink)' }}
          >
            {t('auth.register.loginLink')}
          </Link>
        </p>
      </form>

      <Dialog open={disclaimerOpen} onOpenChange={setDisclaimerOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('auth.register.privacyNotice')}</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto pr-1">
            <DisclaimerContent />
          </div>
        </DialogContent>
      </Dialog>
    </AuthLayout>
  )
}
