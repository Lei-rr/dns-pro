import http from '@/shared/api/http'

export interface SessionState {
  authenticated: boolean
  username: string | null
}

export const authApi = {
  login: (username: string, password: string) =>
    http.post<SessionState>('/session', { username, password }),
  logout: () => http.delete('/session'),
  me: () => http.get<SessionState>('/session'),
}
