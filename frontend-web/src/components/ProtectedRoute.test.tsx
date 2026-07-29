import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from '@/stores/authStore'
import { ProtectedRoute } from './ProtectedRoute'

function renderWithRoute(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<div>Pagina de login</div>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<div>Contenido protegido</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
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
})
