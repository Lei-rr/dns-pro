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
const LOCKOUT_DURATION_MS = 15 * 60 * 1000 // 锁定 15 分钟
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000 // 连续输错时间窗口 15 分钟

interface FailedAttempt {
  count: number
  lastAttemptAt: number
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
      throw new ApiError('invalid_credentials', '用户名或密码不正确', 401)
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
      const minutesLeft = Math.ceil(secondsLeft / 60)
      throw new ApiError(
        'auth_rate_limited',
        `登录连续失败已达5次，IP已被锁定15分钟，请 ${minutesLeft} 分钟后再试（剩余 ${secondsLeft} 秒）`,
        429,
        {
          retry_after: secondsLeft,
        }
      )
    }
    if (record.lockedUntil && record.lockedUntil <= now) {
      this.failedAttempts.delete(ip)
    }
  }

  private recordFailedAttempt(ip: string): void {
    const now = Date.now()
    let record = this.failedAttempts.get(ip)
    if (!record || (record.lastAttemptAt && now - record.lastAttemptAt > ATTEMPT_WINDOW_MS)) {
      record = { count: 0, lastAttemptAt: now }
    }
    record.count += 1
    record.lastAttemptAt = now
    if (record.count >= MAX_LOGIN_ATTEMPTS) {
      record.lockedUntil = now + LOCKOUT_DURATION_MS
    }
    this.failedAttempts.set(ip, record)

    // 内存保护自清理
    if (this.failedAttempts.size > 2000) {
      for (const [key, val] of this.failedAttempts.entries()) {
        if (
          (val.lockedUntil && val.lockedUntil <= now) ||
          (val.lastAttemptAt && now - val.lastAttemptAt > ATTEMPT_WINDOW_MS)
        ) {
          this.failedAttempts.delete(key)
        }
      }
    }
  }

  private clearFailedAttempts(ip: string): void {
    this.failedAttempts.delete(ip)
  }
}
