import http, { POLL_TIMEOUT_MS, unwrapItem } from '@/shared/api/http'
import type { ApiResponse, ApiResult } from '@/shared/api/types'

export interface SessionState {
  authenticated: boolean
  username: string | null
  version?: string
  is_default_credential?: boolean
}

/** 契约守卫：会话端点必须返回会话对象；空体/异形响应由解包器抛错，不让登录态拿到 null */
function isSessionState(value: unknown): value is SessionState {
  return (
    typeof value === 'object' && value !== null && 'authenticated' in value && typeof value.authenticated === 'boolean'
  )
}

export const authApi = {
  login: async (username: string, password: string): Promise<ApiResponse<SessionState>> =>
    unwrapItem(await http.post('/session', { username, password }), isSessionState),
  logout: () => http.delete('/session'),
  me: async (): Promise<ApiResponse<SessionState>> =>
    unwrapItem(await http.get('/session', { timeout: POLL_TIMEOUT_MS }), isSessionState),
  changePassword: (currentPassword: string, newPassword: string): Promise<ApiResult<SessionState>> =>
    http.post('/auth/password', { current_password: currentPassword, new_password: newPassword }),
}
