import type { FastifyInstance } from 'fastify'
import { authRequired } from '../modules/auth/hooks/auth-required.js'
import { routes as systemPublicRoutes } from '../modules/system/routes.js'
import { routes as authRoutes } from '../modules/auth/routes.js'
import { routes as providerRoutes } from '../modules/provider/routes.js'
import { routes as cloudflareRoutes } from '../modules/cloudflare/routes.js'
import { routes as dnspodRoutes } from '../modules/dnspod/routes.js'
import { routes as saasRoutes } from '../modules/saas/routes.js'
import { routes as edgeoneRoutes } from '../modules/edgeone/routes.js'
import { routes as cloudflaredRoutes } from '../modules/cloudflared/routes.js'

/**
 * HTTP route catalog (append-only).
 *
 * Module = business folder under src/modules/* with routes.ts
 * Plugin  = ONLY src/plugins/* (official Fastify shell)
 *
 * Auth model:
 * - public: health + session
 * - one authenticated envelope for all business APIs
 */
export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  // Public
  await app.register(systemPublicRoutes)
  await app.register(authRoutes)

  // Authenticated envelope — single place for authRequired
  await app.register(async function authenticatedApi(scope) {
    scope.addHook('preHandler', authRequired)
    await scope.register(providerRoutes, { prefix: '/providers' })
    await scope.register(cloudflareRoutes, { prefix: '/cloudflare/providers/:providerId' })
    await scope.register(dnspodRoutes, { prefix: '/dnspod/providers/:providerId' })
    await scope.register(saasRoutes, { prefix: '/saas' })
    await scope.register(edgeoneRoutes, { prefix: '/edgeone/providers/:providerId' })
    await scope.register(cloudflaredRoutes, { prefix: '/cloudflared/providers/:providerId' })
  })
}
