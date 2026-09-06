import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'

/** Shell dedicated to the admin area -- deliberately does NOT use <Layout/>:
 * no AppSidebar, no "quick add" FAB, no TransactionModals. It's a view
 * completely separate from the normal app, reachable only from AppSidebar's
 * launcher button (visible only to admins) or by navigating directly to
 * /admin.
 *
 * The role guard lives here (not in the Admin page) for the same reason
 * ProtectedRoute.tsx centralizes the session guard: a single source of
 * truth, and any future admin page added under this layout inherits it
 * for free. */
export function AdminLayout() {
  const { t } = useTranslation('common')
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()

  if (user && user.role !== 'admin') {
    return <Navigate to="/" replace />
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="h-14 flex-shrink-0 flex items-center justify-between px-4 lg:px-8 border-b border-border">
        <div className="flex items-center gap-2.5">
          <svg width="18" height="18" viewBox="0 0 24 24" className="flex-shrink-0">
            <polygon points="12,2 22,12 12,22 2,12" fill="var(--nl-accent)" />
          </svg>
          <span className="text-[14px] font-semibold tracking-tight">NorthernLights</span>
          <span
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{ background: 'var(--nl-accent-soft-bg)', color: 'var(--nl-accent-ink)' }}
          >
            <ShieldCheck size={11} strokeWidth={2.2} />
            {t('adminLayout.badge')}
          </span>
        </div>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          <ArrowLeft size={15} strokeWidth={2} />
          {t('adminLayout.backToApp')}
        </button>
      </header>

      <main className="flex-1 p-4 pt-5 lg:p-8 max-w-[1600px] w-full mx-auto overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  )
}
