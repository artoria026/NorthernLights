import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '@/stores/authStore'
import type { ApiSuccess, TokenPair } from '@/types'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1',
})

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`)
  }
  return config
})

let refreshPromise: Promise<string> | null = null

async function refreshAccessToken(): Promise<string> {
  const refreshToken = useAuthStore.getState().refreshToken
  if (!refreshToken) throw new Error('No hay refresh token')

  const response = await axios.post<ApiSuccess<TokenPair>>(
    `${api.defaults.baseURL}/auth/refresh`,
    { refresh_token: refreshToken },
  )
  // El backend rota el refresh token en cada uso (single-use) -- si solo
  // guardamos el access_token nuevo, el siguiente refresh manda el token
  // viejo (ya invalido en el server) y la sesion muere sola sin aviso.
  const { access_token, refresh_token } = response.data.data
  useAuthStore.getState().setTokens(access_token, refresh_token)
  return access_token
}

// Rutas que devuelven 401 por su cuenta (credenciales invalidas, registro)
// y no tienen nada que ver con una sesion expirada -- no deben disparar el
// refresh ni la redireccion a /login, o el error nunca llega a mostrarse.
const AUTH_ENDPOINTS_WITHOUT_SESSION = ['/auth/login', '/auth/register']

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }
    const isSessionless = AUTH_ENDPOINTS_WITHOUT_SESSION.some((p) => originalRequest?.url?.includes(p))

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry && !isSessionless) {
      originalRequest._retry = true
      try {
        refreshPromise ??= refreshAccessToken()
        const newToken = await refreshPromise
        refreshPromise = null
        originalRequest.headers.set('Authorization', `Bearer ${newToken}`)
        return api(originalRequest)
      } catch {
        refreshPromise = null
        useAuthStore.getState().logout()
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  },
)

export function apiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string } | undefined
    if (data?.error) return data.error
  }
  return 'Ocurrio un error inesperado'
}
