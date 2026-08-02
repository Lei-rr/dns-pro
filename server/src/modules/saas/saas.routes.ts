import type { FastifyInstance } from 'fastify'
import {
  listSaaSZonesHandler,
  listSaaSHostnamesHandler,
  getSaaSHostnameHandler,
  getFallbackOriginHandler,
  updateFallbackOriginHandler,
  deleteFallbackOriginHandler,
} from './saas.handlers.js'
import {
  listPreferredDomainsHandler,
  createPreferredDomainHandler,
  updatePreferredDomainHandler,
  deletePreferredDomainHandler,
  sortPreferredDomainsHandler,
} from './preferred-domain.handlers.js'
import {
  saasFallbackShowSchema,
  saasFallbackWriteSchema,
  saasHostnameShowSchema,
  saasHostnamesIndexSchema,
  saasPreferredDomainParamsSchema,
  saasPreferredDomainSortSchema,
  saasPreferredDomainUpdateSchema,
  saasPreferredDomainWriteSchema,
  saasZoneParamsSchema,
  saasZonesIndexSchema,
} from './saas.schema.js'
import { noRequestSchema } from '../../shared/http/request-schema.js'

async function preferredDomainRoutes(app: FastifyInstance) {
  app.get('/', { schema: noRequestSchema }, listPreferredDomainsHandler)
  app.post('/', { schema: saasPreferredDomainWriteSchema }, createPreferredDomainHandler)
  app.put('/sort-order', { schema: saasPreferredDomainSortSchema }, sortPreferredDomainsHandler)
  app.put('/:domain', { schema: saasPreferredDomainUpdateSchema }, updatePreferredDomainHandler)
  app.delete('/:domain', { schema: saasPreferredDomainParamsSchema }, deletePreferredDomainHandler)
}

async function saasProviderRoutes(app: FastifyInstance) {
  app.get('/zones', { schema: saasZonesIndexSchema }, listSaaSZonesHandler)
  app.get('/zones/:zoneName/hostnames', { schema: saasHostnamesIndexSchema }, listSaaSHostnamesHandler)
  app.get('/zones/:zoneName/hostnames/:hostnameFqdn', { schema: saasHostnameShowSchema }, getSaaSHostnameHandler)
  app.get('/zones/:zoneName/fallback-origin', { schema: saasFallbackShowSchema }, getFallbackOriginHandler)
  app.put('/zones/:zoneName/fallback-origin', { schema: saasFallbackWriteSchema }, updateFallbackOriginHandler)
  app.delete('/zones/:zoneName/fallback-origin', { schema: saasZoneParamsSchema }, deleteFallbackOriginHandler)
}

export async function routes(app: FastifyInstance) {
  app.register(preferredDomainRoutes, { prefix: '/preferred-domains' })
  app.register(saasProviderRoutes, { prefix: '/providers/:providerId' })
}
