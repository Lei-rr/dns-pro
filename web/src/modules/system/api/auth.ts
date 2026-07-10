import http from '@/shared/utils/request'
import { clearProvidersCache } from '@/stores/providers'

const endpoints = {
  session: '/session',
}

let mePromise: Promise<{ data?: { authenticated?: boolean } }> | null = null

function rememberMe(response: { data?: { authenticated?: boolean } }) {
  mePromise = Promise.resolve(response)
  return response
}

export function clearAuthCache() {
  mePromise = null
}

function handleAuthInvalidated() {
  clearAuthCache()
  clearProvidersCache()
}

window.addEventListener('auth-invalidated', handleAuthInvalidated)

export const authApi = {
  login: async (username: string, password: string) => {
    const response = (await http.post(endpoints.session, { username, password })) as {
      data?: { authenticated?: boolean }
    }
    return rememberMe(response)
  },
  logout: async () => {
    handleAuthInvalidated()
    return http.delete(endpoints.session)
  },
  me: () => {
    if (!mePromise) {
      mePromise = (http.get(endpoints.session) as Promise<{
        data?: { authenticated?: boolean }
      }>).catch((error) => {
        clearAuthCache()
        throw error
      })
    }
    return mePromise
  },
}
