import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AdminLayout } from '@/components/AdminLayout'
import { ConfirmDialogHost } from '@/components/ConfirmDialogHost'
import { DisclaimerGate } from '@/components/DisclaimerGate'
import { Layout } from '@/components/Layout'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { ToastHost } from '@/components/ToastHost'
import { useCurrentUser } from '@/hooks/useAuth'
import { useAuthStore } from '@/stores/authStore'
import { useThemeStore } from '@/stores/themeStore'
import { Accounts } from '@/pages/Accounts'
import { Admin } from '@/pages/Admin'
import { Advisor } from '@/pages/Advisor'
import { AuthCallback } from '@/pages/AuthCallback'
import { Budget } from '@/pages/Budget'
import { Categorias } from '@/pages/Categorias'
import { Dashboard } from '@/pages/Dashboard'
import { Debts } from '@/pages/Debts'
import { Goals } from '@/pages/Goals'
import { Insights } from '@/pages/Insights'
import { Login } from '@/pages/Login'
import { Notifications } from '@/pages/Notifications'
import { Recurring } from '@/pages/Recurring'
import { Register } from '@/pages/Register'
import { Reports } from '@/pages/Reports'
import { Settings } from '@/pages/Settings'
import { Subscriptions } from '@/pages/Subscriptions'
import { Transactions } from '@/pages/Transactions'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
})

/** Refresca el perfil desde el servidor al cargar la app (con sesion ya
 * guardada) y aplica el tema de la cuenta si difiere del que quedo en este
 * navegador -- sin esto, el tema solo vivia en localStorage y no viajaba
 * entre dispositivos. `useCurrentUser` ya existia pero no se usaba en
 * ningun lado. */
function AuthBootstrap() {
  const { data: user } = useCurrentUser()
  const setUser = useAuthStore((s) => s.setUser)
  const setThemeMode = useThemeStore((s) => s.setMode)

  useEffect(() => {
    if (!user) return
    setUser(user)
    setThemeMode(user.theme)
  }, [user, setUser, setThemeMode])

  return null
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthBootstrap />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/auth/callback" element={<AuthCallback />} />

          <Route element={<ProtectedRoute />}>
            {/* Area de admin: shell propio (AdminLayout), sin AppSidebar ni nada
                del resto de la app -- ver AdminLayout.tsx para el guard de rol. */}
            <Route element={<AdminLayout />}>
              <Route path="/admin" element={<Admin />} />
            </Route>

            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="/accounts" element={<Accounts />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/categories" element={<Categorias />} />
              <Route path="/debts" element={<Debts />} />
              <Route path="/recurring" element={<Recurring />} />
              <Route path="/subscriptions" element={<Subscriptions />} />
              <Route path="/budget" element={<Budget />} />
              <Route path="/goals" element={<Goals />} />
              <Route path="/insights" element={<Insights />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/advisor" element={<Advisor />} />
            </Route>
          </Route>

          {/* "Importar Datos" se consolido dentro de Asesor IA (adjuntar PDF,
              Excel y el prompt para otra IA ahora viven ahi) -- se deja el
              redirect por si alguien tiene el link viejo guardado. */}
          <Route path="/importar" element={<Navigate to="/advisor" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <ToastHost />
      <ConfirmDialogHost />
      <DisclaimerGate />
    </QueryClientProvider>
  )
}

export default App
