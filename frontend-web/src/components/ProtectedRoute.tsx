import { Navigate, Outlet } from 'react-router-dom'
import { SessionTimeoutHost } from '@/components/SessionTimeoutHost'
import { useAuthStore } from '@/stores/authStore'

export function ProtectedRoute() {
  const accessToken = useAuthStore((s) => s.accessToken)

  if (!accessToken) {
    return <Navigate to="/login" replace />
  }

  return (
    <>
      <SessionTimeoutHost />
      <Outlet />
    </>
  )
}
