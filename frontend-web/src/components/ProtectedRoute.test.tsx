import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/authStore'
import { ProtectedRoute } from './ProtectedRoute'

// The signed-in area pings the server about activity on mount (see useSessionTimeout).
vi.mock('@/services/api', () => ({
  api: { post: vi.fn().mockResolvedValue({ data: { data: { idle_timeout_seconds: 600 } } }) },
}))

function renderWithRoute(initialPath: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/login" element={<div>Pagina de login</div>} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<div>Contenido protegido</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    useAuthStore.getState().logout()
  })

  it('redirects to /login when there is no access token', () => {
    renderWithRoute('/')
    expect(screen.getByText('Pagina de login')).toBeInTheDocument()
  })

  it('renders the protected content when there is an access token', () => {
    useAuthStore.getState().setTokens('token', 'refresh')
    renderWithRoute('/')
    expect(screen.getByText('Contenido protegido')).toBeInTheDocument()
  })

  it('does not show the inactivity countdown while the session is active', () => {
    useAuthStore.getState().setTokens('token', 'refresh')
    renderWithRoute('/')
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
  })
})
