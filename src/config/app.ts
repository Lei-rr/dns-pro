import { z } from 'zod'

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
  trustProxy: boolean
  httpTimeoutMs: number
}

const appConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  logLevel: z.union([z.string().min(1), z.literal(false)]),
  dataDir: z.string().min(1),
  cacheMaxEntries: z.number().int().positive(),
  cacheSweepIntervalMs: z.number().int().positive(),
  sessionSecret: z.string().min(1),
  sessionCookieName: z.string().min(1),
  sessionMaxAgeSeconds: z.number().int().positive(),
  cookieSecure: z.boolean(),
  cookieSameSite: z.enum(['lax', 'strict', 'none']),
  rateLimitGlobalMax: z.number().int().positive(),
  rateLimitLoginMax: z.number().int().positive(),
  rateLimitTimeWindow: z.string().min(1),
  trustProxy: z.boolean(),
  httpTimeoutMs: z.number().int().min(1000).max(300000),
})

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return ['1', 'true', 'yes'].includes(value.toLowerCase())
}

function parseSameSite(value: string | undefined): AppConfig['cookieSameSite'] {
  if (value === 'strict' || value === 'none' || value === 'lax') return value
  return 'lax'
}

export function loadAppConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const logLevelRaw = process.env.LOG_LEVEL
  const dataDir = process.env.DATA_DIR ?? process.cwd()

  const config: AppConfig = {
    host: process.env.HOST ?? '0.0.0.0',
    port: Number(process.env.PORT ?? 2022),
    logLevel: logLevelRaw && logLevelRaw !== 'silent' ? logLevelRaw : false,
    dataDir,
    cacheMaxEntries: Number(process.env.CACHE_MAX_ENTRIES ?? 1000),
    cacheSweepIntervalMs: Number(process.env.CACHE_SWEEP_INTERVAL_MS ?? 10 * 60 * 1000),
    sessionSecret: process.env.SESSION_SECRET ?? 'dns-pro-secure-session',
    sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'dns_pro_session',
    sessionMaxAgeSeconds: Number(process.env.SESSION_MAX_AGE_SECONDS ?? 7 * 24 * 60 * 60),
    cookieSecure: parseBoolean(process.env.COOKIE_SECURE, false),
    cookieSameSite: parseSameSite(process.env.COOKIE_SAME_SITE),
    rateLimitGlobalMax: Number(process.env.RATE_LIMIT_GLOBAL_MAX ?? 300),
    rateLimitLoginMax: Number(process.env.RATE_LIMIT_LOGIN_MAX ?? 10),
    rateLimitTimeWindow: process.env.RATE_LIMIT_TIME_WINDOW ?? '1 minute',
    trustProxy: parseBoolean(process.env.TRUST_PROXY, false),
    httpTimeoutMs: Number(process.env.HTTP_TIMEOUT_MS ?? 30000),
    ...overrides,
  }

  return appConfigSchema.parse(config)
}
