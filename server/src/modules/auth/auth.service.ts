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

const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 15 * 60 * 1000 // 15 minutes

interface FailedAttempt {
  count: number
  lockedUntil?: number
}

export class SessionService {
  private readonly failedAttempts = new Map<string, FailedAttempt>()

  constructor(private readonly authConfig: AuthConfig) {}

  async initialize(): Promise<void> {
    await this.authConfig.initialize()
  }

  async isDefaultCredential(): Promise<boolean> {
    return this.authConfig.isDefaultCredential()
  }

  async login(request: FastifyRequest, username: string, password: string): Promise<SessionState> {
    const ip = request.ip || '127.0.0.1'
    this.checkRateLimit(ip)

    const valid = await this.authConfig.verifyCredentials(username, password)
    if (!valid) {
      this.recordFailedAttempt(ip)
      throw new ApiError('invalid_credentials', 'Invalid username or password', 401)
    }

    this.clearFailedAttempts(ip)
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

  private checkRateLimit(ip: string): void {
    const record = this.failedAttempts.get(ip)
    if (!record) return
    const now = Date.now()
    if (record.lockedUntil && record.lockedUntil > now) {
      const secondsLeft = Math.ceil((record.lockedUntil - now) / 1000)
      throw new ApiError('auth_rate_limited', `登录失败次数过多，已被临时锁定，请 ${secondsLeft} 秒后再试`, 429, {
        retry_after: secondsLeft,
      })
    }
    if (record.lockedUntil && record.lockedUntil <= now) {
      this.failedAttempts.delete(ip)
    }
  }

  private recordFailedAttempt(ip: string): void {
    const now = Date.now()
    const record = this.failedAttempts.get(ip) ?? { count: 0 }
    record.count += 1
    if (record.count >= MAX_LOGIN_ATTEMPTS) {
      record.lockedUntil = now + LOCKOUT_DURATION_MS
    }
    this.failedAttempts.set(ip, record)
  }

  private clearFailedAttempts(ip: string): void {
    this.failedAttempts.delete(ip)
  }
}
