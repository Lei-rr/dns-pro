import type { FastifyRequest } from 'fastify'
import { AppConfig } from '../support/app-config.js'
import { ApiError } from '../support/api-error.js'
import { signIn, signOut, isSignedIn, getUsername } from '../support/auth-session.js'

export interface SessionState {
  authenticated: boolean
  username: string | null
}

export class SessionService {
  constructor(private readonly config: AppConfig = new AppConfig()) {}

  async login(request: FastifyRequest, username: string, password: string): Promise<SessionState> {
    const valid = await this.config.verifyCredentials(username, password)
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
