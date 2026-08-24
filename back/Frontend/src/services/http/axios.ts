import axios from 'axios'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { AuthResponse } from '@/types/auth'

let accessToken: string | null = null
let refreshToken: string | null = null
let persistTokens: ((tokens: {
  accessToken: string
  refreshToken: string
}) => void) | null = null
let onAuthFailure: (() => void) | null = null
let refreshInFlight: Promise<string> | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

export function setRefreshToken(token: string | null): void {
  refreshToken = token
}

export function setTokenPersistHandler(
  handler: ((tokens: { accessToken: string; refreshToken: string }) => void) | null,
): void {
  persistTokens = handler
}

export function setOnAuthFailure(handler: (() => void) | null): void {
  onAuthFailure = handler
}

type ApiError = Error & { status?: number }

function toApiError(error: unknown): ApiError {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string | string[] } | undefined
    const raw = data?.message
    const message = Array.isArray(raw)
      ? raw.join(', ')
      : (raw ?? error.message ?? 'Erreur réseau')
    const err = new Error(message) as ApiError
    err.status = error.response?.status
    return err
  }

  if (error instanceof Error) return error
  return new Error('Erreur réseau')
}

function isAuthPublicPath(url?: string): boolean {
  if (!url) return false
  return /\/auth\/(login|register|refresh|forgot-password|reset-password)(\?|$)/.test(
    url,
  )
}

const refreshClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  timeout: 10000,
})

async function rotateAccessToken(): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      let token = refreshToken

      if (!token && typeof window !== 'undefined') {
        const { getSession } = await import('next-auth/react')
        const session = await getSession()
        token = session?.refreshToken ?? null
      }

      if (!token) {
        throw new Error('Session expirée')
      }

      const { data } = await refreshClient.post<AuthResponse>('/auth/refresh', {
        refreshToken: token,
      })

      accessToken = data.accessToken
      refreshToken = data.refreshToken
      persistTokens?.({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      })

      return data.accessToken
    })().finally(() => {
      refreshInFlight = null
    })
  }

  return refreshInFlight
}

const instance_api: AxiosInstance = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  timeout: 10000,
})

instance_api.interceptors.request.use(async (config) => {
  let token = accessToken

  if (!token && typeof window !== 'undefined') {
    const { getSession } = await import('next-auth/react')
    const session = await getSession()
    token = session?.accessToken ?? null
    if (token) accessToken = token
    if (session?.refreshToken) refreshToken = session.refreshToken
  }

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  return config
})

instance_api.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) {
      return Promise.reject(error)
    }

    const original = error.config as
      | (InternalAxiosRequestConfig & { _retry?: boolean })
      | undefined
    const status = error.response?.status

    if (
      status === 401 &&
      original &&
      !original._retry &&
      !isAuthPublicPath(original.url)
    ) {
      original._retry = true

      try {
        const nextAccess = await rotateAccessToken()
        original.headers.Authorization = `Bearer ${nextAccess}`
        return instance_api(original)
      } catch (refreshError) {
        onAuthFailure?.()
        return Promise.reject(toApiError(refreshError))
      }
    }

    return Promise.reject(toApiError(error))
  },
)

export default instance_api
