export interface AppConfig {
  host: string
  port: number
  logLevel: string | false
  dataDir: string
  cacheMaxEntries: number
  cacheSweepIntervalMs: number
  sessionSecret: string
  sessionCookieName: string
  sessionMaxAgeSeconds: number
  cookieSecure: boolean
  cookieSameSite: 'lax' | 'strict' | 'none'
  rateLimitGlobalMax: number
  rateLimitLoginMax: number
  rateLimitTimeWindow: string
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return ['1', 'true', 'yes'].includes(value.toLowerCase())
}

export function loadAppConfig(): AppConfig {
  const dataDir = process.env.DATA_DIR ?? process.cwd()

  const logLevel = process.env.LOG_LEVEL
  return {
    host: process.env.HOST ?? '0.0.0.0',
    port: Number(process.env.PORT ?? 2022),
    logLevel: logLevel && logLevel !== 'silent' ? logLevel : false,
    dataDir,
    cacheMaxEntries: Number(process.env.CACHE_MAX_ENTRIES ?? 1000),
    cacheSweepIntervalMs: Number(process.env.CACHE_SWEEP_INTERVAL_MS ?? 10 * 60 * 1000),
    sessionSecret: process.env.SESSION_SECRET ?? 'dns-pro-secure-session',
    sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'dns_pro_session',
    sessionMaxAgeSeconds: Number(process.env.SESSION_MAX_AGE_SECONDS ?? 7 * 24 * 60 * 60),
    cookieSecure: parseBoolean(process.env.COOKIE_SECURE, false),
    cookieSameSite: (process.env.COOKIE_SAME_SITE as AppConfig['cookieSameSite']) ?? 'lax',
    rateLimitGlobalMax: Number(process.env.RATE_LIMIT_GLOBAL_MAX ?? 300),
    rateLimitLoginMax: Number(process.env.RATE_LIMIT_LOGIN_MAX ?? 10),
    rateLimitTimeWindow: process.env.RATE_LIMIT_TIME_WINDOW ?? '1 minute',
  }
}
