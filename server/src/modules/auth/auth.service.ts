import type { FastifyRequest } from 'fastify'
import { AuthConfig } from './auth-config.service.js'
import { ApiError } from '../../shared/http/api-error.js'
import { signIn, signOut, isSignedIn, getUsername } from '../../shared/auth/auth-session.js'

export interface SessionState {
  authenticated: boolean
  username: string | null
}

export class SessionService {
  constructor(private readonly authConfig: AuthConfig) {}

  async initialize(): Promise<void> {
    await this.authConfig.initialize()
  }

  async login(request: FastifyRequest, username: string, password: string): Promise<SessionState> {
    const valid = await this.authConfig.verifyCredentials(username, password)
    if (!valid) {
      throw new ApiError('invalid_credentials', 'Invalid username or password', 401)
    }

    signIn(request, username)

    return this.currentSession(request)
  }

  logout(request: FastifyRequest): void {
    signOut(request)
  }

  currentSession(request: FastifyRequest): SessionState {
    return {
      authenticated: isSignedIn(request),
      username: getUsername(request),
    }
  }
}
