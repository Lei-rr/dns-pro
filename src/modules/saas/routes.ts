import type { FastifyInstance } from 'fastify'
import {
  zonesIndex, hostnamesIndex, hostnamesStore, hostnamesShow, hostnamesUpdate, hostnamesReconcile,
  hostnamesDelete, fallbackOriginShow, fallbackOriginUpdate, fallbackOriginDelete,
} from './controllers/hostname-controller.js'
import {
  preferredApplyPreview, preferredApplyStore, preferredApplyShow, preferredApplyActive, preferredApplyRetry,
} from './controllers/preferred-apply-controller.js'
import { batchDeleteStore, batchUpdateStore, batchJobShow, batchJobActive, batchJobRetry } from './controllers/batch-controller.js'
import {
  preferredDomainsIndex, preferredDomainsStore, preferredDomainsUpdate, preferredDomainsDelete, preferredDomainsSort,
} from './controllers/preferred-domain-controller.js'
import {
  saasBatchDeleteSchema, saasBatchUpdateSchema, saasFallbackShowSchema, saasFallbackWriteSchema,
  saasHostnameDeleteSchema, saasHostnameParamsSchema, saasHostnameShowSchema, saasHostnameStoreSchema,
  saasHostnameUpdateSchema, saasHostnamesIndexSchema, saasJobParamsSchema, saasPreferredApplySchema,
  saasPreferredDomainParamsSchema, saasPreferredDomainSortSchema, saasPreferredDomainUpdateSchema,
  saasPreferredDomainWriteSchema, saasZoneParamsSchema, saasZonesIndexSchema,
} from './schemas.js'
import { noRequestSchema } from '../../lib/http/request-schema.js'

async function preferredDomainRoutes(app: FastifyInstance) {
  app.get('/', { schema: noRequestSchema }, preferredDomainsIndex)
  app.post('/', { schema: saasPreferredDomainWriteSchema }, preferredDomainsStore)
  app.put('/sort-order', { schema: saasPreferredDomainSortSchema }, preferredDomainsSort)
  app.put('/:domain', { schema: saasPreferredDomainUpdateSchema }, preferredDomainsUpdate)
  app.delete('/:domain', { schema: saasPreferredDomainParamsSchema }, preferredDomainsDelete)
}

async function saasProviderRoutes(app: FastifyInstance) {
  app.get('/zones', { schema: saasZonesIndexSchema }, zonesIndex)
  app.get('/zones/:zoneName/hostnames', { schema: saasHostnamesIndexSchema }, hostnamesIndex)
  app.post('/zones/:zoneName/hostnames', { schema: saasHostnameStoreSchema }, hostnamesStore)
  app.get('/zones/:zoneName/hostnames/:hostnameFqdn', { schema: saasHostnameShowSchema }, hostnamesShow)
  app.put('/zones/:zoneName/hostnames/:hostnameFqdn', { schema: saasHostnameUpdateSchema }, hostnamesUpdate)
  app.delete('/zones/:zoneName/hostnames/:hostnameFqdn', { schema: saasHostnameDeleteSchema }, hostnamesDelete)
  app.post('/zones/:zoneName/hostnames/:hostnameFqdn/reconcile', { schema: saasHostnameParamsSchema }, hostnamesReconcile)
  app.get('/zones/:zoneName/fallback-origin', { schema: saasFallbackShowSchema }, fallbackOriginShow)
  app.put('/zones/:zoneName/fallback-origin', { schema: saasFallbackWriteSchema }, fallbackOriginUpdate)
  app.delete('/zones/:zoneName/fallback-origin', { schema: saasZoneParamsSchema }, fallbackOriginDelete)

  app.get('/zones/:zoneName/preferred-apply/active', { schema: saasZoneParamsSchema }, preferredApplyActive)
  app.post('/zones/:zoneName/preferred-apply/preview', { schema: saasPreferredApplySchema }, preferredApplyPreview)
  app.post('/zones/:zoneName/preferred-apply', { schema: saasPreferredApplySchema }, preferredApplyStore)

  app.get('/zones/:zoneName/batch/active', { schema: saasZoneParamsSchema }, batchJobActive)
  app.post('/zones/:zoneName/batch/delete', { schema: saasBatchDeleteSchema }, batchDeleteStore)
  app.post('/zones/:zoneName/batch/update', { schema: saasBatchUpdateSchema }, batchUpdateStore)
}

async function preferredApplyJobRoutes(app: FastifyInstance) {
  app.get('/:jobId', { schema: saasJobParamsSchema }, preferredApplyShow)
  app.post('/:jobId/retry', { schema: saasJobParamsSchema }, preferredApplyRetry)
}

async function batchJobRoutes(app: FastifyInstance) {
  app.get('/:jobId', { schema: saasJobParamsSchema }, batchJobShow)
  app.post('/:jobId/retry', { schema: saasJobParamsSchema }, batchJobRetry)
}

export async function routes(app: FastifyInstance) {
  app.register(preferredDomainRoutes, { prefix: '/preferred-domains' })
  app.register(saasProviderRoutes, { prefix: '/providers/:providerId' })
  app.register(preferredApplyJobRoutes, { prefix: '/preferred-apply' })
  app.register(batchJobRoutes, { prefix: '/batch' })
}
