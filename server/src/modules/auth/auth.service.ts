import type { FastifyRequest } from 'fastify'
import { AuthConfig } from './auth-config.service.js'
import { ApiError } from '../../shared/http/api-error.js'
import { signIn, signOut, isSignedIn, getUsername } from '../../shared/auth/auth-session.js'
import { APP_VERSION } from '../../shared/version.js'

export { APP_VERSION }

export interface SessionState {
  authenticated: boolean
  username: string | null
  version?: string
  is_default_credential?: boolean
}

export class SessionService {
  constructor(private readonly authConfig: AuthConfig) {}

  async initialize(): Promise<void> {
    await this.authConfig.initialize()
  }

  async isDefaultCredential(): Promise<boolean> {
    return this.authConfig.isDefaultCredential()
  }

  async login(request: FastifyRequest, username: string, password: string): Promise<SessionState> {
    const valid = await this.authConfig.verifyCredentials(username, password)
    if (!valid) {
      throw new ApiError('invalid_credentials', '用户名或密码不正确', 401)
    }

    signIn(request, username)
    return this.currentSession(request)
  }

  logout(request: FastifyRequest): void {
    signOut(request)
  }

  async currentSession(request: FastifyRequest): Promise<SessionState> {
    const authenticated = isSignedIn(request)
    const isDefault = authenticated ? await this.authConfig.isDefaultCredential() : undefined
    return {
      authenticated,
      username: getUsername(request),
      version: APP_VERSION,
      ...(isDefault !== undefined ? { is_default_credential: isDefault } : {}),
    }
  }
}
