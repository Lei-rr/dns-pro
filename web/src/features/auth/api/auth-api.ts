import http, { POLL_TIMEOUT_MS } from '@/shared/api/http'

export interface SessionState {
  authenticated: boolean
  username: string | null
  version?: string
  is_default_credential?: boolean
}

export const authApi = {
  login: (username: string, password: string) => http.post<SessionState>('/session', { username, password }),
  logout: () => http.delete('/session'),
  me: () => http.get<SessionState>('/session', { timeout: POLL_TIMEOUT_MS }),
  changePassword: (currentPassword: string, newPassword: string) =>
    http.post<SessionState>('/auth/password', { current_password: currentPassword, new_password: newPassword }),
}
