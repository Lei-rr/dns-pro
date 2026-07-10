import path from 'node:path'
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

const DEFAULT_CONFIG: AppConfig = {
  host: '0.0.0.0',
  port: 2022,
  logLevel: false,
  dataDir: path.resolve('data'),
  cacheMaxEntries: 1000,
  cacheSweepIntervalMs: 10 * 60 * 1000,
  sessionSecret: 'dns-pro-secure-session',
  sessionCookieName: 'dns_pro_session',
  sessionMaxAgeSeconds: 7 * 24 * 60 * 60,
  cookieSecure: false,
  cookieSameSite: 'lax',
  rateLimitGlobalMax: 300,
  rateLimitLoginMax: 10,
  rateLimitTimeWindow: '1 minute',
  trustProxy: false,
  httpTimeoutMs: 30000,
}

export function loadAppConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return appConfigSchema.parse({ ...DEFAULT_CONFIG, ...overrides })
}
