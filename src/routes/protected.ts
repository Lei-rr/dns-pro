import type { FastifyInstance } from 'fastify'
import { authRequired } from '../middleware/auth-required.js'
import { providerRoutes } from './provider.js'
import { cloudflareRoutes } from './cloudflare.js'
import { dnspodRoutes } from './dnspod.js'
import { saasRoutes } from './saas.js'
import { edgeOneRoutes } from './edgeone.js'
import { cloudflaredRoutes } from './cloudflared.js'

export async function protectedRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authRequired)

  app.register(providerRoutes)
  app.register(cloudflareRoutes)
  app.register(dnspodRoutes)
  app.register(saasRoutes)
  app.register(edgeOneRoutes)
  app.register(cloudflaredRoutes)
}
