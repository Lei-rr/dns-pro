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

async function preferredDomainRoutes(app: FastifyInstance) {
  app.get('/', preferredDomainsIndex)
  app.post('/', { schema: { body: preferredDomainStoreSchema } }, preferredDomainsStore)
  app.put('/sort', { schema: { body: preferredDomainSortSchema } }, preferredDomainsSort)
  app.put('/:domain', { schema: { body: preferredDomainUpdateSchema } }, preferredDomainsUpdate)
  app.delete('/:domain', preferredDomainsDelete)
}

async function saasProviderRoutes(app: FastifyInstance) {
  app.get('/zones', { schema: { querystring: saasListZonesQuerySchema } }, zonesIndex)
  app.get('/zones/:zoneName/hostnames', { schema: { querystring: saasListHostnamesQuerySchema } }, hostnamesIndex)
  app.post('/zones/:zoneName/hostnames', { schema: { body: saasStoreBodySchema } }, hostnamesStore)
  app.get('/zones/:zoneName/hostnames/:hostnameFqdn', { schema: { querystring: saasShowQuerySchema } }, hostnamesShow)
  app.put('/zones/:zoneName/hostnames/:hostnameFqdn', { schema: { body: saasUpdateBodySchema } }, hostnamesUpdate)
  app.delete('/zones/:zoneName/hostnames/:hostnameFqdn', hostnamesDelete)
  app.post('/zones/:zoneName/hostnames/:hostnameFqdn/refresh', hostnamesRefresh)
  app.get('/zones/:zoneName/fallback-origin', { schema: { querystring: saasShowQuerySchema } }, fallbackOriginShow)
  app.put('/zones/:zoneName/fallback-origin', { schema: { body: saasFallbackOriginBodySchema } }, fallbackOriginUpdate)
  app.delete('/zones/:zoneName/fallback-origin', fallbackOriginDelete)
}

export async function saasRoutes(app: FastifyInstance) {
  app.register(preferredDomainRoutes, { prefix: '/preferred-domains' })
  app.register(saasProviderRoutes, { prefix: '/providers/:providerId' })
}
