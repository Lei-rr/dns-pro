import http from '@/shared/utils/request'

export interface SessionState {
  authenticated: boolean
  username: string | null
}

const endpoints = {
  session: '/session',
}

export const authApi = {
  login: (username: string, password: string) => http.post<SessionState>(endpoints.session, { username, password }),
  logout: () => http.delete(endpoints.session),
  me: () => http.get<SessionState>(endpoints.session),
}
