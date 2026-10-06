import type { FastifyInstance } from 'fastify'
import {
  createDnsBatchHandler,
  deleteDnsBatchHandler,
  getActiveDnsBatchHandler,
  getDnsBatchHandler,
  retryDnsBatchHandler,
  updateDnsBatchHandler,
} from './dns-batch.handlers.js'
import {
  dnsBatchCreateSchema,
  dnsBatchDeleteSchema,
  dnsBatchUpdateSchema,
  dnsJobParamsSchema,
  dnsZoneParamsSchema,
} from './dns-batch.schema.js'
import type { DnsProviderType } from '../../core/contracts/dns-record.port.js'

/** 同一套批量路由分别挂到 DNSPod / Cloudflare 前缀下 */
export function createDnsBatchRoutes(providerType: DnsProviderType) {
  return async function dnsBatchRoutes(app: FastifyInstance): Promise<void> {
    app.post('/zones/:zone/records/batch-create', { schema: dnsBatchCreateSchema }, createDnsBatchHandler(providerType))
    app.post('/zones/:zone/records/batch-delete', { schema: dnsBatchDeleteSchema }, deleteDnsBatchHandler(providerType))
    app.post('/zones/:zone/records/batch-update', { schema: dnsBatchUpdateSchema }, updateDnsBatchHandler(providerType))
    app.get(
      '/zones/:zone/records/batch/active',
      { schema: dnsZoneParamsSchema },
      getActiveDnsBatchHandler(providerType)
    )
    app.get('/records/batch/:jobId', { schema: dnsJobParamsSchema }, getDnsBatchHandler(providerType))
    app.post('/records/batch/:jobId/retry', { schema: dnsJobParamsSchema }, retryDnsBatchHandler(providerType))
  }
}
