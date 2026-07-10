import type { FastifyInstance } from 'fastify'
import {
  saasListZonesQuerySchema,
  saasListHostnamesQuerySchema,
  saasShowQuerySchema,
  saasStoreBodySchema,
  saasUpdateBodySchema,
  saasFallbackOriginBodySchema,
  preferredDomainStoreSchema,
  preferredDomainUpdateSchema,
  preferredDomainSortSchema,
} from '../schemas/saas.js'
import {
  zonesIndex,
  hostnamesIndex,
  hostnamesStore,
  hostnamesShow,
  hostnamesUpdate,
  hostnamesRefresh,
  hostnamesDelete,
  fallbackOriginShow,
  fallbackOriginUpdate,
  fallbackOriginDelete,
} from '../controllers/saas/saas-controller.js'
import {
  preferredDomainsIndex,
  preferredDomainsStore,
  preferredDomainsUpdate,
  preferredDomainsDelete,
  preferredDomainsSort,
} from '../controllers/saas/preferred-domain-controller.js'

export async function saasRoutes(app: FastifyInstance) {
  app.get('/saas/preferred-domains', preferredDomainsIndex)
  app.post('/saas/preferred-domains', { schema: { body: preferredDomainStoreSchema } }, preferredDomainsStore)
  app.put('/saas/preferred-domains/sort', { schema: { body: preferredDomainSortSchema } }, preferredDomainsSort)
  app.put('/saas/preferred-domains/:domain', { schema: { body: preferredDomainUpdateSchema } }, preferredDomainsUpdate)
  app.delete('/saas/preferred-domains/:domain', preferredDomainsDelete)

  app.get('/saas/providers/:providerId/zones', { schema: { querystring: saasListZonesQuerySchema } }, zonesIndex)
  app.get(
    '/saas/providers/:providerId/zones/:zoneName/hostnames',
    { schema: { querystring: saasListHostnamesQuerySchema } },
    hostnamesIndex
  )
  app.post(
    '/saas/providers/:providerId/zones/:zoneName/hostnames',
    { schema: { body: saasStoreBodySchema } },
    hostnamesStore
  )
  app.get(
    '/saas/providers/:providerId/zones/:zoneName/hostnames/:hostnameFqdn',
    { schema: { querystring: saasShowQuerySchema } },
    hostnamesShow
  )
  app.put(
    '/saas/providers/:providerId/zones/:zoneName/hostnames/:hostnameFqdn',
    { schema: { body: saasUpdateBodySchema } },
    hostnamesUpdate
  )
  app.delete('/saas/providers/:providerId/zones/:zoneName/hostnames/:hostnameFqdn', hostnamesDelete)
  app.post('/saas/providers/:providerId/zones/:zoneName/hostnames/:hostnameFqdn/refresh', hostnamesRefresh)
  app.get(
    '/saas/providers/:providerId/zones/:zoneName/fallback-origin',
    { schema: { querystring: saasShowQuerySchema } },
    fallbackOriginShow
  )
  app.put(
    '/saas/providers/:providerId/zones/:zoneName/fallback-origin',
    { schema: { body: saasFallbackOriginBodySchema } },
    fallbackOriginUpdate
  )
  app.delete('/saas/providers/:providerId/zones/:zoneName/fallback-origin', fallbackOriginDelete)
}
