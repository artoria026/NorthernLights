import {
  ArrowLeftRight,
  Bell,
  Bot,
  Building2,
  ChevronDown,
  Coins,
  Home,
  LogOut,
  Menu,
  Moon,
  PiggyBank,
  RefreshCw,
  Repeat,
  Settings,
  Sun,
  Tag,
  Target,
  TrendingUp,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ChangelogButton, ChangelogDialog } from '@/components/ChangelogButton'
import { useLogout, useSyncedTheme } from '@/hooks/useAuth'
import { useUnreadCount } from '@/hooks/useNotifications'
import { useAuthStore } from '@/stores/authStore'
import { useConfirmStore } from '@/stores/confirmStore'
// Build version, shown in the footer of this sidebar -- a single source of
// truth (package.json) instead of hardcoding the string here too.
import pkg from '../../package.json'

// Icon set "A -- Direct/concrete" (see navbar-and-font-proposals.html):
// prioritizes the most literal metaphor for each action over a generic icon.
const PRINCIPAL_ITEMS = [
  { to: '/', end: true, icon: Home, label: 'Inicio' },
  { to: '/accounts', end: false, icon: Building2, label: 'Cuentas' },
  { to: '/transactions', end: false, icon: ArrowLeftRight, label: 'Transacciones' },
  { to: '/budget', end: false, icon: PiggyBank, label: 'Presupuesto' },
]

const COMPROMISOS_ITEMS = [
  { to: '/debts', end: false, icon: Coins, label: 'Deudas' },
  { to: '/recurring', end: false, icon: RefreshCw, label: 'Recurrentes' },
  { to: '/subscriptions', end: false, icon: Repeat, label: 'Suscripciones' },
]

function navItemClass({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-3 px-3 py-2.5 rounded-md text-[13px] transition-colors ${
    isActive
      ? 'bg-primary/15 text-primary font-medium'
      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
  }`
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-3.5 pb-1 text-[11px] tracking-wide text-muted-foreground font-semibold">
      {children}
    </div>
  )
}

function CollapsibleGroup({
  label,
  open,
  onToggle,
  children,
}: {
  label: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between py-1 text-[11px] tracking-wide text-muted-foreground font-semibold"
      >
        {label}
        <ChevronDown
          size={10}
          strokeWidth={2.5}
          className="transition-transform"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        />
      </button>
      {open && <div className="flex flex-col py-1.5 pb-3.5 gap-0.5">{children}</div>}
    </div>
  )
}

function initials(name: string | undefined) {
  if (!name) return '?'
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function AppSidebar() {
  const user = useAuthStore((s) => s.user)
  const { mode, setTheme } = useSyncedTheme()
  const { data: unreadCount } = useUnreadCount()
  const navigate = useNavigate()
  const location = useLocation()
  const logout = useLogout()
  const confirm = useConfirmStore((s) => s.ask)

  async function handleLogout() {
    const ok = await confirm({
      title: 'Cerrar sesión',
      message: '¿Seguro que quieres cerrar sesión?',
      confirmLabel: 'Cerrar sesión',
      variant: 'danger',
      icon: LogOut,
    })
    if (!ok) return
    await logout.mutateAsync()
    navigate('/login')
  }
  const [moreOpen, setMoreOpen] = useState(false)
  const [reportsOpen, setReportsOpen] = useState(true)
  // The full drawer (below) is "position: fixed" on mobile -- it doesn't push
  // content, it opens on top. It closes automatically on every route change so
  // we don't have to wire an onClick on every NavLink in this file.
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  return (
    <>
      {/* Mobile top bar -- the only thing that takes up real space in the
          flow on mobile (the drawer below is a fixed overlay, it pushes
          nothing). */}
      <header
        className="lg:hidden flex items-center justify-between h-14 px-4 border-b border-sidebar-border flex-shrink-0"
        style={{ background: 'var(--sidebar)' }}
      >
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="group p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
          aria-label="Abrir menú"
        >
          <Menu size={20} strokeWidth={1.8} className="transition-transform duration-200 group-hover:scale-110" />
        </button>
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" className="flex-shrink-0">
            <polygon points="12,2 22,12 12,22 2,12" fill="var(--nl-accent)" />
          </svg>
          <span className="text-[14px] font-semibold tracking-tight">NorthernLights</span>
        </div>
        <div className="flex items-center gap-0.5">
          <ChangelogButton iconSize={18} />
          <button
            type="button"
            onClick={() => navigate('/notifications')}
            className="group relative p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
            aria-label="Notificaciones"
          >
            <Bell
              size={18}
              strokeWidth={1.8}
              className="origin-top group-hover:[animation:nlIconRing_0.5s_ease]"
            />
            {!!unreadCount && unreadCount > 0 && (
              <span
                className="absolute top-0 right-0 min-w-[14px] h-[14px] px-0.5 rounded-full text-[9px] font-semibold flex items-center justify-center"
                style={{ background: 'var(--nl-danger)', color: '#ffffff' }}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        className={`w-[280px] min-w-[280px] border-r border-sidebar-border flex flex-col h-screen z-50 transition-transform duration-200 fixed inset-y-0 left-0 lg:sticky lg:top-0 lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ background: 'var(--sidebar)' }}
      >
        <div className="h-[60px] min-h-[60px] flex items-center justify-between px-3.5 pl-5 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <svg width="20" height="20" viewBox="0 0 24 24" className="flex-shrink-0">
              <polygon points="12,2 22,12 12,22 2,12" fill="var(--nl-accent)" />
            </svg>
            <span className="text-[15px] font-semibold tracking-tight">NorthernLights</span>
          </div>
          <div className="flex items-center gap-0.5">
          <button
            type="button"
            title={mode === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            onClick={() => setTheme(mode === 'dark' ? 'light' : 'dark')}
            className="group p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            {mode === 'dark' ? (
              <Sun size={16} strokeWidth={1.8} className="transition-transform duration-500 group-hover:rotate-90" />
            ) : (
              <Moon size={16} strokeWidth={1.8} className="transition-transform duration-500 group-hover:-rotate-45" />
            )}
          </button>
          <ChangelogButton />
          <button
            type="button"
            title="Notificaciones"
            onClick={() => navigate('/notifications')}
            className="group relative p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            <Bell
              size={16}
              strokeWidth={1.8}
              className="origin-top group-hover:[animation:nlIconRing_0.5s_ease]"
            />
            {!!unreadCount && unreadCount > 0 && (
              <span
                className="absolute top-0 right-0 min-w-[14px] h-[14px] px-0.5 rounded-full text-[9px] font-semibold flex items-center justify-center"
                style={{ background: 'var(--nl-danger)', color: '#ffffff' }}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="group lg:hidden p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
            aria-label="Cerrar menú"
          >
            <X size={16} strokeWidth={1.8} className="transition-transform duration-200 group-hover:rotate-90" />
          </button>
        </div>
      </div>

      <nav className="px-2 flex flex-col gap-0.5 mt-3.5">
        <SectionLabel>Principal</SectionLabel>
        {/* Inicio first, Asesor IA right after -- it's the app's main
            function, not an extra at the bottom of "Inteligencia" (see
            pulsing dot). */}
        {PRINCIPAL_ITEMS.slice(0, 1).map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={navItemClass}>
            <item.icon size={17} strokeWidth={2} />
            <span>{item.label}</span>
          </NavLink>
        ))}
        <NavLink to="/advisor" className={navItemClass}>
          {({ isActive }) => (
            <>
              <Bot size={17} strokeWidth={2} />
              <span className="flex-1">Asesor IA</span>
              {!isActive && (
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: 'var(--nl-accent)', animation: 'pulseDot 1.6s ease-in-out infinite' }}
                />
              )}
            </>
          )}
        </NavLink>
        {PRINCIPAL_ITEMS.slice(1).map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={navItemClass}>
            <item.icon size={17} strokeWidth={2} />
            <span>{item.label}</span>
          </NavLink>
        ))}

        <SectionLabel>Compromisos</SectionLabel>
        {COMPROMISOS_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={navItemClass}>
            <item.icon size={17} strokeWidth={2} />
            <span>{item.label}</span>
          </NavLink>
        ))}

        <SectionLabel>Inteligencia</SectionLabel>
        <NavLink to="/insights" className={navItemClass}>
          <TrendingUp size={17} strokeWidth={2} />
          <span>Insights</span>
        </NavLink>
      </nav>

      <div className="px-4 pt-2 flex-1 overflow-y-auto">
        <CollapsibleGroup label="MÁS" open={moreOpen} onToggle={() => setMoreOpen((v) => !v)}>
          <NavLink to="/categories" className="flex items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground py-1.5">
            <Tag size={14} strokeWidth={2} />
            Categorías
          </NavLink>
          <NavLink to="/goals" className="flex items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground py-1.5">
            <Target size={14} strokeWidth={2} />
            Metas
          </NavLink>
        </CollapsibleGroup>

        <CollapsibleGroup label="REPORTES" open={reportsOpen} onToggle={() => setReportsOpen((v) => !v)}>
          <NavLink to="/reports?section=networth" className="text-[13px] text-muted-foreground hover:text-foreground py-1.5">
            Historial de patrimonio
          </NavLink>
          <NavLink to="/reports?flow=expense" className="text-[13px] text-muted-foreground hover:text-foreground py-1.5">
            Desglose de gastos
          </NavLink>
        </CollapsibleGroup>
      </div>

      <div className="flex-shrink-0 h-[60px] flex items-center px-4 border-t border-sidebar-border gap-2">
        <NavLink to="/settings" className="flex items-center gap-2.5 flex-1 min-w-0 hover:opacity-80 transition-opacity">
          {user?.avatar_url ? (
            <img
              src={user.avatar_url}
              alt=""
              className="w-7 h-7 rounded-full object-cover flex-shrink-0"
            />
          ) : (
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] flex-shrink-0"
              style={{ background: 'var(--nl-bg-track)' }}
            >
              {initials(user?.name)}
            </div>
          )}
          <span className="text-[13px] flex-1 text-left truncate">{user?.name ?? 'Usuario'}</span>
        </NavLink>
        <NavLink to="/settings" title="Configuración" className="group p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent flex-shrink-0">
          <Settings size={16} strokeWidth={1.8} className="transition-transform duration-500 group-hover:rotate-90" />
        </NavLink>
        <button
          type="button"
          title="Cerrar sesión"
          onClick={handleLogout}
          className="group p-1.5 rounded-md text-destructive hover:bg-destructive/10 flex-shrink-0"
        >
          <LogOut size={16} strokeWidth={1.8} className="transition-transform duration-200 group-hover:translate-x-0.5" />
        </button>
      </div>
      <div className="flex-shrink-0 py-1.5 text-center text-[10px] text-muted-foreground">
        NorthernLights v{pkg.version}
      </div>
      </div>

      {/* A single instance for the two ChangelogButton above (mobile bar
          + sidebar) -- see comment in ChangelogButton.tsx. */}
      <ChangelogDialog />
    </>
  )
}
