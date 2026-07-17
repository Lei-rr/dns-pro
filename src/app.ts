import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import type { AppConfig } from './config/app.js'
import { createAppContext } from './app-context.js'
import { appContextPlugin } from './plugins/app-context.js'
import { securityPlugin } from './plugins/security.js'
import { staticPlugin } from './plugins/static.js'
import { errorHandlerPlugin } from './plugins/error-handler.js'
import { buildHttpModules, mountHttpModules } from './compose/http-modules.js'
import './types/fastify.d.ts'

/**
 * FOUNDATION — do not redesign.
 *
 * Official Fastify composition only:
 * 1) createAppContext (wire services)
 * 2) root plugins: fastify-plugin + @fastify/*
 * 3) encapsulating /api/v1 + module catalog
 *
 * Feature work goes in src/modules/* and compose/http-modules.ts (append).
 * See docs/FOUNDATION.md
 */
export async function buildApp(config: AppConfig) {
  const DEFAULT_SESSION_SECRET = 'dns-pro-secure-session'

  const app = Fastify({
    logger: config.logLevel ? { level: config.logLevel } : false,
    trustProxy: config.trustProxy,
    requestIdHeader: 'x-request-id',
    genReqId: (req) => {
      const incoming = req.headers['x-request-id']
      if (typeof incoming === 'string' && incoming.trim()) return incoming.trim()
      return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
    },
  })

  if (config.sessionSecret === DEFAULT_SESSION_SECRET) {
    console.warn('[WARN] SESSION_SECRET is using the default value. Please set a strong secret in production.')
  }

  const ctx = await createAppContext(config)

  // Root-visible decorations → official fastify-plugin
  await app.register(appContextPlugin, { ctx })
  await app.register(securityPlugin, { config }) // @fastify/cookie helmet sensible
  await app.register(staticPlugin) // @fastify/static compress

  // Core register + prefix — not a custom router
  await app.register(async function apiV1(api) {
    await mountHttpModules(api, buildHttpModules())
  }, { prefix: '/api/v1' })

  await app.register(errorHandlerPlugin)

  return app
}

export type { FastifyInstance }
