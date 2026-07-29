import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { Navigate, Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'

/** Shell dedicado al area de administracion -- a proposito NO usa <Layout/>:
 * sin AppSidebar, sin el FAB de "agregar rapido", sin TransactionModals. Es
 * una vista completamente separada de la app normal, solo alcanzable desde
 * el boton-lanzador de AppSidebar (visible solo para admins) o entrando
 * directo a /admin.
 *
 * El guard de rol vive aqui (no en la pagina Admin) por la misma razon que
 * ProtectedRoute.tsx centraliza el guard de sesion: una sola fuente de
 * verdad, y cualquier pagina admin futura que se agregue bajo este layout lo
 * hereda gratis. */
export function AdminLayout() {
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
            Admin
          </span>
        </div>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          <ArrowLeft size={15} strokeWidth={2} />
          Volver a la app
        </button>
      </header>

      <main className="flex-1 p-4 pt-5 lg:p-8 max-w-[1600px] w-full mx-auto overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  )
}
