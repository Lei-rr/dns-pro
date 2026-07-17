import type { FastifyInstance } from 'fastify'
import type { ModuleDefinition } from '../kernel/index.js'
import { defineModule } from '../kernel/index.js'
import { authRequired } from '../modules/auth/hooks/auth-required.js'
import { routes as systemRoutes } from '../modules/system/routes.js'
import { routes as authRoutes } from '../modules/auth/routes.js'
import { routes as providerRoutes } from '../modules/provider/routes.js'
import { routes as cloudflareRoutes } from '../modules/cloudflare/routes.js'
import { routes as dnspodRoutes } from '../modules/dnspod/routes.js'
import { routes as saasRoutes } from '../modules/saas/routes.js'
import { routes as edgeoneRoutes } from '../modules/edgeone/routes.js'
import { routes as cloudflaredRoutes } from '../modules/cloudflared/routes.js'

/**
 * APPEND-ONLY feature route catalog.
 * New feature = modules/<name> + wire (if needed) + one entry here.
 * Native app.register only — never wrap routes in fastify-plugin.
 */
export function buildHttpModules(): ModuleDefinition[] {
  return [
    defineModule({
      name: 'system',
      publicRoutes: async (app) => {
        await app.register(systemRoutes)
      },
    }),
    defineModule({
      name: 'auth',
      publicRoutes: async (app) => {
        await app.register(authRoutes)
      },
    }),
    defineModule({
      name: 'provider',
      routes: async (app) => {
        await app.register(providerRoutes, { prefix: '/providers' })
      },
    }),
    defineModule({
      name: 'cloudflare',
      routes: async (app) => {
        await app.register(cloudflareRoutes, { prefix: '/cloudflare/providers/:providerId' })
      },
    }),
    defineModule({
      name: 'dnspod',
      routes: async (app) => {
        await app.register(dnspodRoutes, { prefix: '/dnspod/providers/:providerId' })
      },
    }),
    defineModule({
      name: 'saas',
      routes: async (app) => {
        await app.register(saasRoutes, { prefix: '/saas' })
      },
    }),
    defineModule({
      name: 'edgeone',
      routes: async (app) => {
        await app.register(edgeoneRoutes, { prefix: '/edgeone/providers/:providerId' })
      },
    }),
    defineModule({
      name: 'cloudflared',
      routes: async (app) => {
        await app.register(cloudflaredRoutes, { prefix: '/cloudflared/providers/:providerId' })
      },
    }),
  ]
}

export async function mountHttpModules(app: FastifyInstance, modules: ModuleDefinition[]): Promise<void> {
  for (const mod of modules) {
    if (mod.publicRoutes) await mod.publicRoutes(app)
  }

  await app.register(async function authenticatedApi(scope) {
    scope.addHook('preHandler', authRequired)
    for (const mod of modules) {
      if (mod.routes) await mod.routes(scope)
    }
  })
}
