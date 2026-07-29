import path from 'node:path'

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
  trustProxy: boolean
  httpTimeoutMs: number
}

const DEFAULT_CONFIG: AppConfig = {
  host: '0.0.0.0',
  port: 2022,
  logLevel: false,
  dataDir: path.resolve('data'),
  cacheMaxEntries: 1000,
  cacheSweepIntervalMs: 10 * 60 * 1000,
  sessionSecret: '',
  sessionCookieName: 'dns_pro_session',
  sessionMaxAgeSeconds: 7 * 24 * 60 * 60,
  cookieSecure: false,
  cookieSameSite: 'lax',
  trustProxy: false,
  httpTimeoutMs: 30000,
}

export function loadAppConfig(
  overrides: Partial<AppConfig> = {},
  env: NodeJS.ProcessEnv = process.env,
): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    sessionSecret: String(env.SESSION_SECRET ?? '').trim(),
    ...overrides,
  }
}
