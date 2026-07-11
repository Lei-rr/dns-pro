import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import type { AppConfig } from './config/app.js'
import { createAppContext } from './app-context.js'
import { securityPlugin } from './plugins/security.js'
import { staticPlugin } from './plugins/static.js'
import { errorHandlerPlugin } from './plugins/error-handler.js'
import { systemModule } from './modules/system/index.js'
import { authModule } from './modules/auth/index.js'
import { authRequired } from './modules/auth/hooks/auth-required.js'
import { providerModule } from './modules/provider/index.js'
import { cloudflareModule } from './modules/cloudflare/index.js'
import { dnspodModule } from './modules/dnspod/index.js'
import { saasModule } from './modules/saas/index.js'
import { edgeoneModule } from './modules/edgeone/index.js'
import { cloudflaredModule } from './modules/cloudflared/index.js'
import './types/session.js'

async function protectedModules(app: FastifyInstance) {
  app.addHook('preHandler', authRequired)
  await app.register(providerModule)
  await app.register(cloudflareModule)
  await app.register(dnspodModule)
  await app.register(saasModule)
  await app.register(edgeoneModule)
  await app.register(cloudflaredModule)
}

export function buildApp(config: AppConfig) {
  const DEFAULT_SESSION_SECRET = 'dns-pro-secure-session'

  const app = Fastify({
    logger: config.logLevel ? { level: config.logLevel } : false,
    trustProxy: config.trustProxy,
  })

  if (config.sessionSecret === DEFAULT_SESSION_SECRET) {
    console.warn('[WARN] SESSION_SECRET is using the default value. Please set a strong secret in production.')
  }

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  app.decorate('ctx', createAppContext(config))

  securityPlugin(app, config)
  app.register(staticPlugin)
  app.register(systemModule, { prefix: '/api' })
  app.register(authModule, { prefix: '/api' })
  app.register(protectedModules, { prefix: '/api' })
  app.register(errorHandlerPlugin)

  return app
}
