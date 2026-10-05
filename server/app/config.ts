import path from 'node:path'

export interface AppConfig {
  host: string
  port: number
  logLevel: string | false
  dataDir: string
  /** 静态资源根目录；默认 <cwd>/web/dist，可用 WEB_DIST_DIR 覆盖 */
  webDistDir?: string
  sessionSecret: string
  sessionCookieName: string
  sessionMaxAgeSeconds: number
  cookieSecure: boolean
  cookieSameSite: 'lax' | 'strict' | 'none'
  /** false / 可信代理地址列表；true 会信任任意转发头，仅允许程序内 overrides 显式传入（环境变量侧拒绝） */
  trustProxy: boolean | string[]
  httpTimeoutMs: number
}

const DEFAULT_CONFIG: AppConfig = {
  host: '0.0.0.0',
  port: 2022,
  logLevel: 'info',
  dataDir: path.resolve('data'),
  webDistDir: path.resolve('web/dist'),
  sessionSecret: '',
  sessionCookieName: 'dns_pro_session',
  sessionMaxAgeSeconds: 7 * 24 * 60 * 60,
  cookieSecure: false,
  cookieSameSite: 'lax',
  trustProxy: false,
  httpTimeoutMs: 30000,
}

const SAME_SITE = new Set(['lax', 'strict', 'none'])

function envString(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim()
  return value ? value : undefined
}

function envBool(env: NodeJS.ProcessEnv, key: string): boolean | undefined {
  const value = envString(env, key)?.toLowerCase()
  if (value === undefined) return undefined
  if (['1', 'true', 'yes', 'on'].includes(value)) return true
  if (['0', 'false', 'no', 'off'].includes(value)) return false
  throw new Error(`${key} must be a boolean (true/false)`)
}

/**
 * TRUST_PROXY：false 或逗号分隔的 IP/CIDR（如 127.0.0.1,10.0.0.0/8）。
 * 两类取值都拒绝：
 * - 数字跳数：Fastify 5 对数字 trustProxy 采取 fail-closed，若改成按跳数信任，
 *   直连客户端只要带一个 X-Forwarded-For 就能冒充来源 IP，绕开按 IP 的登录锁定与审计；
 * - true：Fastify 的全信任语义同样采信任意 X-Forwarded-For，效果与按跳数信任一致。
 * 需要信任代理时必须显式列出受信网段。
 */
function envTrustProxy(env: NodeJS.ProcessEnv): AppConfig['trustProxy'] | undefined {
  const value = envString(env, 'TRUST_PROXY')
  if (value === undefined) return undefined
  if (/^\d+$/.test(value)) {
    throw new Error(
      'TRUST_PROXY must not be a hop count; use a trusted proxy IP/CIDR list instead (e.g. 127.0.0.1,10.0.0.0/8)'
    )
  }
  const lower = value.toLowerCase()
  if (lower === 'true') {
    throw new Error(
      'TRUST_PROXY=true is not accepted: trusting every proxy lets any direct client spoof its source IP via X-Forwarded-For. List the trusted proxy IPs/CIDRs instead (e.g. 127.0.0.1,10.0.0.0/8)'
    )
  }
  if (lower === 'false') return false
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function envInt(env: NodeJS.ProcessEnv, key: string, min: number, max: number): number | undefined {
  const value = envString(env, key)
  if (value === undefined) return undefined
  const num = Number(value)
  if (!Number.isInteger(num) || num < min || num > max) throw new Error(`${key} must be an integer in [${min}, ${max}]`)
  return num
}

const PINO_LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])

/** 校验日志级别：false/off 归一为 silent；非法值 fail-fast（避免把错误级别传给 pino 后启动崩溃） */
function normalizeLogLevel(source: string, value: string): string {
  const level = value.trim().toLowerCase()
  if (level === 'false' || level === 'off') return 'silent'
  if (!PINO_LEVELS.has(level)) throw new Error(`${source} must be one of: ${[...PINO_LEVELS].join(', ')}`)
  return level
}

function envLogLevel(env: NodeJS.ProcessEnv): string | undefined {
  const value = envString(env, 'LOG_LEVEL')
  return value === undefined ? undefined : normalizeLogLevel('LOG_LEVEL', value)
}

/**
 * 配置优先级：命令行参数 > 环境变量 > 默认值。
 * 环境变量：HOST PORT LOG_LEVEL DATA_DIR WEB_DIST_DIR SESSION_SECRET COOKIE_SECURE COOKIE_SAMESITE TRUST_PROXY HTTP_TIMEOUT_MS
 */
export function loadAppConfig(overrides: Partial<AppConfig> = {}, env: NodeJS.ProcessEnv = process.env): AppConfig {
  const sameSite = envString(env, 'COOKIE_SAMESITE')?.toLowerCase()
  if (sameSite !== undefined && !SAME_SITE.has(sameSite)) throw new Error('COOKIE_SAMESITE must be lax, strict or none')
  const dataDir = envString(env, 'DATA_DIR')
  const webDistDir = envString(env, 'WEB_DIST_DIR')

  const fromEnv: Partial<AppConfig> = {
    host: envString(env, 'HOST'),
    port: envInt(env, 'PORT', 1, 65535),
    logLevel: envLogLevel(env),
    dataDir: dataDir ? path.resolve(dataDir) : undefined,
    webDistDir: webDistDir ? path.resolve(webDistDir) : undefined,
    sessionSecret: envString(env, 'SESSION_SECRET'),
    cookieSecure: envBool(env, 'COOKIE_SECURE'),
    cookieSameSite: sameSite as AppConfig['cookieSameSite'] | undefined,
    trustProxy: envTrustProxy(env),
    httpTimeoutMs: envInt(env, 'HTTP_TIMEOUT_MS', 1000, 300000),
  }
  const defined = <T extends object>(value: T) =>
    Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<AppConfig>

  const config = { ...DEFAULT_CONFIG, ...defined(fromEnv), ...defined(overrides) }
  // SameSite=None 必须配合 Secure，否则浏览器拒收 Cookie
  if (config.cookieSameSite === 'none' && !config.cookieSecure) {
    throw new Error('COOKIE_SAMESITE=none requires COOKIE_SECURE=true')
  }
  return config
}

/**
 * 解析命令行：--port/-p <n>  --log-level <level>。
 * 未知选项与缺值直接抛错（与 loadAppConfig 对非法环境变量的 fail-fast 一致，避免拼错后按默认值静默启动）；
 * 位置参数继续忽略：npm run dev 会注入 watch 与脚本名。
 */
export function parseCliOverrides(args: string[]): Partial<AppConfig> {
  const overrides: Partial<AppConfig> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg || !arg.startsWith('-')) continue
    const value = args[i + 1]
    if (!value || value.startsWith('-')) throw new Error(`${arg} requires a value`)
    if (arg === '--log-level') {
      overrides.logLevel = normalizeLogLevel('--log-level', value)
      i++
    } else if (arg === '--port' || arg === '-p') {
      const port = Number(value)
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${value}`)
      overrides.port = port
      i++
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }
  return overrides
}
