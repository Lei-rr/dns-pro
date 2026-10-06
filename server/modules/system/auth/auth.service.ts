import type { FastifyReply, FastifyRequest } from 'fastify'
import { ApiError } from '../../../core/http/api-error.js'
import { authRateLimited } from '../../../core/http/auth-rate-limit.js'
import { deriveSessionKey, openSession, sealSession, sessionVersion } from '../../../core/security/session-token.js'
import { safeEqual, verifyPassword } from '../../../core/security/password.js'
import { storePath } from '../../../core/store/store-registry.js'
import { APP_VERSION } from '../../../core/version.js'
import type { AuthConfigRepository, AuthState } from './auth-config.repository.js'

export interface SessionCookieOptions {
  secret: string
  cookieName: string
  maxAgeSeconds: number
  secure: boolean
  sameSite: 'lax' | 'strict' | 'none'
}

interface SessionState {
  authenticated: boolean
  username: string | null
  version?: string
  is_default_credential?: boolean
}

// 按来源 IP 计数：被攻击者无法用少量失败把管理员整体锁死
const IP_MAX_FAILURES = 10
const IP_LOCK_MS = 15 * 60 * 1000
// 全局兜底（阈值高、时间短）：防止伪造转发头轮换 IP 的分布式猜测
const GLOBAL_MAX_FAILURES = 50
const GLOBAL_LOCK_MS = 5 * 60 * 1000
const IP_TRACK_LIMIT = 512
const MIN_PASSWORD_LENGTH = 8
const DEFAULT_USERNAME = 'admin'
const DEFAULT_PASSWORD = 'admin'
// 常见弱口令：与默认账号同一风险等级
const WEAK_PASSWORDS = new Set([
  'password',
  'passw0rd',
  '12345678',
  '123456789',
  '1234567890',
  'qwertyui',
  'admin123',
  'administrator',
  'dnspro123',
])

/**
 * 认证：密码以 scrypt 哈希存储，Cookie 会话绑定「用户名+凭据+会话代次」指纹。
 * 修改密码或登出后，所有旧会话立即失效。
 */
export class AuthService {
  private readonly key: Buffer
  private readonly defaultCredentialCache = new Map<string, boolean>()
  private readonly ipLocks = new Map<string, { failures: number; lockedUntil: number; lastFailureAt: number }>()
  private globalFailures = 0
  private globalLockedUntil = 0

  constructor(
    private readonly repository: AuthConfigRepository,
    private readonly cookie: SessionCookieOptions
  ) {
    this.key = deriveSessionKey(cookie.secret)
  }

  /** 启动时把手工写入的明文密码升级为哈希；返回是否升级 */
  async upgradePlaintextCredential(): Promise<boolean> {
    return this.repository.hashPlaintextCredential()
  }

  /** 解析请求 Cookie，返回已登录用户名或 null */
  async authenticate(request: FastifyRequest): Promise<string | null> {
    return (await this.authenticateSession(request))?.username ?? null
  }

  /** 会话解析与会话状态读取合并为一次，供 currentSession 复用（read() 每次都会读盘并 chmod） */
  private async authenticateSession(request: FastifyRequest): Promise<{ username: string; state: AuthState } | null> {
    const claims = this.cookieTokens(request)
      .map((token) => openSession(token, this.key))
      .find((value) => value !== null)
    if (!claims) return null
    const state = await this.repository.read()
    if (!safeEqual(claims.version, this.versionOf(state)) || claims.username !== state.username) return null
    return { username: claims.username, state }
  }

  async login(reply: FastifyReply, username: string, password: string, clientIp: string): Promise<SessionState> {
    this.assertNotLocked(clientIp)

    const state = await this.repository.read()
    if (state.username === '' || state.credential === '') {
      throw new ApiError('server_error', `Authentication is not configured in data/${storePath('auth')}`, 500)
    }
    // 两项都比较，避免短路造成时序差异
    const userOk = safeEqual(state.username, username)
    const passOk = await this.matches(state, password)
    if (!userOk || !passOk) {
      this.recordFailure(clientIp)
      throw new ApiError('invalid_credentials', '用户名或密码不正确', 401)
    }
    this.ipLocks.delete(clientIp)

    // 明文凭据登录成功后立即升级为哈希（版本随之变化，需按新状态签发）
    const current = state.plaintext === null ? state : await this.hashAndReload()
    this.issueSession(reply, current)
    return {
      authenticated: true,
      username,
      version: APP_VERSION,
      is_default_credential: await this.isDefaultCredential(current),
    }
  }

  /** 修改密码：校验当前密码，写入哈希，并为当前设备重新签发会话 */
  async changePassword(
    reply: FastifyReply,
    currentPassword: string,
    newPassword: string,
    clientIp: string
  ): Promise<SessionState> {
    this.assertNotLocked(clientIp)
    const state = await this.repository.read()
    if (!(await this.matches(state, currentPassword))) {
      // 与登录共用失败计数：持有会话者也不能无限猜测当前密码
      this.recordFailure(clientIp)
      throw new ApiError('invalid_credentials', '当前密码不正确', 401)
    }
    this.ipLocks.delete(clientIp)
    assertPasswordPolicy(newPassword, state)
    await this.repository.setPassword(newPassword)

    // 旧 Cookie 随凭据变更失效，这里按新状态签发，当前设备保持登录
    const updated = await this.repository.read()
    this.issueSession(reply, updated)
    return {
      authenticated: true,
      username: updated.username,
      version: APP_VERSION,
      is_default_credential: await this.isDefaultCredential(updated),
    }
  }

  /** 登出：递增会话代次，吊销所有设备上的会话 */
  async logout(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (await this.authenticate(request)) await this.repository.bumpSessionEpoch()
    reply.clearCookie(this.cookie.cookieName, this.cookieBase())
  }

  async currentSession(request: FastifyRequest): Promise<SessionState> {
    const session = await this.authenticateSession(request)
    if (!session) return { authenticated: false, username: null }
    return {
      authenticated: true,
      username: session.username,
      version: APP_VERSION,
      is_default_credential: await this.isDefaultCredential(session.state),
    }
  }

  /** 是否仍在使用 admin/admin（升级后的哈希同样能识别），结果按凭据材料缓存；可复用调用方已读到的状态 */
  async isDefaultCredential(state?: AuthState): Promise<boolean> {
    const current = state ?? (await this.repository.read())
    if (current.username !== DEFAULT_USERNAME || current.credential === '') return false
    const cached = this.defaultCredentialCache.get(current.credential)
    if (cached !== undefined) return cached

    const isDefault =
      current.plaintext !== null
        ? safeEqual(current.plaintext, DEFAULT_PASSWORD)
        : await verifyPassword(DEFAULT_PASSWORD, current.credential)
    // 仅密码变更时新增键，容量有限
    if (this.defaultCredentialCache.size > 8) this.defaultCredentialCache.clear()
    this.defaultCredentialCache.set(current.credential, isDefault)
    return isDefault
  }

  /** 登录与改密码共用：按来源 IP 计数，并有高阈值全局兜底 */
  private recordFailure(clientIp: string): void {
    const now = Date.now()
    const entry = this.ipLocks.get(clientIp) ?? { failures: 0, lockedUntil: 0, lastFailureAt: now }
    if (now >= entry.lockedUntil) entry.failures = 0
    entry.failures += 1
    entry.lastFailureAt = now
    if (entry.failures >= IP_MAX_FAILURES) {
      entry.failures = 0
      entry.lockedUntil = now + IP_LOCK_MS
    }
    this.ipLocks.set(clientIp, entry)
    this.pruneIpLocks(now)

    if (++this.globalFailures >= GLOBAL_MAX_FAILURES) {
      this.globalFailures = 0
      this.globalLockedUntil = now + GLOBAL_LOCK_MS
    }
  }

  private assertNotLocked(clientIp: string): void {
    const now = Date.now()
    const perIpUntil = this.ipLocks.get(clientIp)?.lockedUntil ?? 0
    const until = Math.max(perIpUntil > now ? perIpUntil : 0, this.globalLockedUntil)
    if (until <= now) return
    const limited = authRateLimited(until - now)
    throw new ApiError(limited.code, limited.message, 429, limited.details)
  }

  /**
   * 清理来源 IP 计数：先丢弃已解锁且无计数的条目；仍超限时按最后失败时间淘汰最旧的未锁定条目。
   * 锁定中的条目必须保留，否则攻击者可用大量来源 IP 冲掉自己正在生效的锁定。
   */
  private pruneIpLocks(now: number): void {
    if (this.ipLocks.size <= IP_TRACK_LIMIT) return
    for (const [ip, entry] of this.ipLocks) {
      if (now >= entry.lockedUntil && entry.failures === 0) this.ipLocks.delete(ip)
    }
    if (this.ipLocks.size <= IP_TRACK_LIMIT) return
    const evictable = [...this.ipLocks]
      .filter(([, entry]) => now >= entry.lockedUntil)
      .sort((a, b) => a[1].lastFailureAt - b[1].lastFailureAt)
    for (const [ip] of evictable) {
      if (this.ipLocks.size <= IP_TRACK_LIMIT) break
      this.ipLocks.delete(ip)
    }
  }

  private async matches(state: AuthState, password: string): Promise<boolean> {
    return state.plaintext !== null
      ? safeEqual(state.plaintext, password)
      : await verifyPassword(password, state.credential)
  }

  private async hashAndReload(): Promise<AuthState> {
    await this.repository.hashPlaintextCredential()
    return this.repository.read()
  }

  private issueSession(reply: FastifyReply, state: AuthState): void {
    const token = sealSession(
      {
        username: state.username,
        expiresAt: Date.now() + this.cookie.maxAgeSeconds * 1000,
        version: this.versionOf(state),
      },
      this.key
    )
    reply.setCookie(this.cookie.cookieName, token, { ...this.cookieBase(), maxAge: this.cookie.maxAgeSeconds })
  }

  /** 浏览器可能同时带上新旧同名 Cookie（路径/格式变更后），逐个尝试 */
  private cookieTokens(request: FastifyRequest): string[] {
    const header = request.headers.cookie
    if (typeof header !== 'string' || header.length > 8192) return []
    const prefix = `${this.cookie.cookieName}=`
    return header
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(prefix))
      .map((part) => part.slice(prefix.length))
      .slice(0, 5)
  }

  private versionOf(state: AuthState): string {
    return sessionVersion(this.key, { username: state.username, credential: state.credential }, state.sessionEpoch)
  }

  private cookieBase() {
    return { path: '/', httpOnly: true, secure: this.cookie.secure, sameSite: this.cookie.sameSite } as const
  }
}

function assertPasswordPolicy(password: string, state: AuthState): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ApiError('password_too_weak', `新密码至少 ${MIN_PASSWORD_LENGTH} 位`, 422)
  }
  const normalized = password.toLowerCase()
  const username = state.username.toLowerCase()
  if (
    WEAK_PASSWORDS.has(normalized) ||
    normalized === username ||
    normalized.includes(username) ||
    normalized.includes('dns-pro')
  ) {
    throw new ApiError('password_too_weak', '新密码过于简单，请勿包含用户名或使用常见弱口令', 422)
  }
}
