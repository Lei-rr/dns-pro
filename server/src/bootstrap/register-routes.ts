import type { FastifyInstance } from 'fastify'
import { authRequired } from '../shared/auth/auth-required.js'
import { routes as systemPublicRoutes } from '../modules/system/system.routes.js'
import { routes as authRoutes } from '../modules/auth/auth.routes.js'
import { routes as providerRoutes } from '../workflows/provider-management/provider-management.routes.js'
import { routes as cloudflareRoutes } from '../modules/cloudflare/cloudflare.routes.js'
import { routes as dnspodRoutes } from '../modules/dns-pod/dns-pod.routes.js'
import { createDnsBatchRoutes } from '../workflows/dns-batch/dns-batch.routes.js'
import { routes as saasRoutes } from '../modules/saas/saas.routes.js'
import { routes as saasDnsSyncRoutes } from '../workflows/saas-dns-sync/saas-dns-sync.routes.js'
import { routes as edgeoneRoutes } from '../modules/edge-one/edge-one.routes.js'
import { routes as edgeOneDnsSyncRoutes } from '../workflows/edge-one-dns-sync/edge-one-dns-sync.routes.js'
import { routes as cloudflaredRoutes } from '../modules/tunnels/tunnel.routes.js'

/**
 * HTTP route catalog (append-only).
 *
 * Module = business folder under server/src/modules/* with routes.ts
 * Plugin  = ONLY server/src/plugins/* (official Fastify shell)
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
    await scope.register(createDnsBatchRoutes('cloudflare'), { prefix: '/cloudflare/providers/:providerId' })
    await scope.register(dnspodRoutes, { prefix: '/dnspod/providers/:providerId' })
    await scope.register(createDnsBatchRoutes('dnspod'), { prefix: '/dnspod/providers/:providerId' })
    await scope.register(saasRoutes, { prefix: '/saas' })
    await scope.register(saasDnsSyncRoutes, { prefix: '/saas' })
    await scope.register(edgeoneRoutes, { prefix: '/edgeone/providers/:providerId' })
    await scope.register(edgeOneDnsSyncRoutes, { prefix: '/edgeone/providers/:providerId' })
    await scope.register(cloudflaredRoutes, { prefix: '/cloudflared/providers/:providerId' })
  })
}
