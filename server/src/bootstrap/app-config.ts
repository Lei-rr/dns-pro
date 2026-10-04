import path from 'node:path'

export interface AppConfig {
  host: string
  port: number
  logLevel: string | false
  dataDir: string
  sessionSecret: string
  sessionCookieName: string
  sessionMaxAgeSeconds: number
  cookieSecure: boolean
  cookieSameSite: 'lax' | 'strict' | 'none'
  /** false / 跳数 / 可信代理地址列表（不建议 true：会信任任意 X-Forwarded-For） */
  trustProxy: boolean | number | string[]
  httpTimeoutMs: number
}

const DEFAULT_CONFIG: AppConfig = {
  host: '0.0.0.0',
  port: 2022,
  logLevel: false,
  dataDir: path.resolve('data'),
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

/** TRUST_PROXY：true/false、跳数（如 1）或逗号分隔的 IP/CIDR（如 127.0.0.1,10.0.0.0/8） */
function envTrustProxy(env: NodeJS.ProcessEnv): AppConfig['trustProxy'] | undefined {
  const value = envString(env, 'TRUST_PROXY')
  if (value === undefined) return undefined
  if (/^\d+$/.test(value)) return Number(value)
  const lower = value.toLowerCase()
  if (['true', 'false'].includes(lower)) return lower === 'true'
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

/**
 * 配置优先级：命令行参数 > 环境变量 > 默认值。
 * 环境变量：HOST PORT LOG_LEVEL DATA_DIR SESSION_SECRET COOKIE_SECURE COOKIE_SAMESITE TRUST_PROXY HTTP_TIMEOUT_MS
 */
export function loadAppConfig(overrides: Partial<AppConfig> = {}, env: NodeJS.ProcessEnv = process.env): AppConfig {
  const sameSite = envString(env, 'COOKIE_SAMESITE')?.toLowerCase()
  if (sameSite !== undefined && !SAME_SITE.has(sameSite)) throw new Error('COOKIE_SAMESITE must be lax, strict or none')
  const dataDir = envString(env, 'DATA_DIR')

  const fromEnv: Partial<AppConfig> = {
    host: envString(env, 'HOST'),
    port: envInt(env, 'PORT', 1, 65535),
    logLevel: envString(env, 'LOG_LEVEL'),
    dataDir: dataDir ? path.resolve(dataDir) : undefined,
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

/** 解析命令行：--port/-p <n>  --log-level <level> */
export function parseCliOverrides(args: string[]): Partial<AppConfig> {
  const overrides: Partial<AppConfig> = {}
  for (let i = 0; i < args.length; i++) {
    const value = args[i + 1]
    if (args[i] === '--log-level' && value) {
      overrides.logLevel = value
      i++
    } else if ((args[i] === '--port' || args[i] === '-p') && value) {
      const port = Number(value)
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${value}`)
      overrides.port = port
      i++
    }
  }
  return overrides
}
