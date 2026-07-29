import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/authStore'
import { Login } from './Login'

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api')
  return {
    ...actual,
    api: { post: vi.fn(), get: vi.fn() },
  }
})

import { api } from '@/services/api'

function renderLogin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/login']}>
        <Login />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Login page', () => {
  beforeEach(() => {
    useAuthStore.getState().logout()
    localStorage.clear()
    vi.mocked(api.post).mockReset()
    vi.mocked(api.get).mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the login form', () => {
    renderLogin()
    expect(screen.getByLabelText(/correo/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/contraseña/i)).toBeInTheDocument()
  })

  it('shows the backend error message on failed login', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { error: 'Usuario o contraseña incorrectos' } },
    })

    renderLogin()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/correo/i), 'test@example.com')
    await user.type(screen.getByLabelText(/contraseña/i), 'wrong-password')
    await user.click(screen.getByRole('button', { name: /entrar/i }))

    expect(await screen.findByText('Usuario o contraseña incorrectos')).toBeInTheDocument()
    // El email se conserva, solo se borra la contraseña
    expect(screen.getByLabelText(/correo/i)).toHaveValue('test@example.com')
    expect(screen.getByLabelText(/contraseña/i)).toHaveValue('')
  })

  it('stores tokens and user on successful login', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { data: { access_token: 'tok', refresh_token: 'ref', token_type: 'bearer' } },
    })
    vi.mocked(api.get).mockResolvedValueOnce({
      data: {
        data: {
          id: '1',
          email: 'test@example.com',
          name: 'Test',
          role: 'user',
          auth_provider: 'email',
          created_at: '2026-01-01',
        },
      },
    })

    renderLogin()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/correo/i), 'test@example.com')
    await user.type(screen.getByLabelText(/contraseña/i), 'supersecret123')
    await user.click(screen.getByRole('button', { name: /entrar/i }))

    await waitFor(() => {
      expect(useAuthStore.getState().accessToken).toBe('tok')
    })
    expect(useAuthStore.getState().user?.email).toBe('test@example.com')
  })
})
