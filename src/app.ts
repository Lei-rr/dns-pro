import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import type { AppConfig } from './config/app.js'
import { createAppContext } from './app-context.js'
import { appContextPlugin } from './plugins/app-context.js'
import { securityPlugin } from './plugins/security.js'
import { staticPlugin } from './plugins/static.js'
import { errorHandlerPlugin } from './plugins/error-handler.js'
import { registerApiRoutes } from './compose/http-modules.js'
import './types/fastify.d.ts'

/**
 * HTTP shell — official Fastify only.
 *
 * plugins/*  = Fastify plugins (cookie/helmet/static/session/ctx)
 * modules/*  = business features (routes + services)
 * platform/* = job store + event bus + data dirs
 *
 * Composition: plugins = HTTP shell; modules = business; platform = jobs/events.
 */
export async function buildApp(config: AppConfig) {
  if (config.sessionSecret.trim().length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters')
  }

  const app = Fastify({
    logger: config.logLevel ? { level: config.logLevel } : false,
    trustProxy: config.trustProxy,
    requestIdHeader: 'x-request-id',
    genReqId: (req) => {
      const incoming = req.headers['x-request-id']
      if (typeof incoming === 'string' && incoming.trim()) return incoming.trim()
      return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
    },
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  })

  const ctx = await createAppContext(config)

  await app.register(appContextPlugin, { ctx })
  await app.register(securityPlugin, { config })
  await app.register(staticPlugin)
  await app.register(errorHandlerPlugin)

  // Keep /api — no version prefix (personal panel, no public API versioning)
  await app.register(async function api(scope) {
    await registerApiRoutes(scope)
  }, { prefix: '/api' })

  return app
}

export type { FastifyInstance }
