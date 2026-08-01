import type { FastifyInstance } from 'fastify'
import {
  edgeoneBatchDeleteSchema,
  edgeoneBatchDisableSchema,
  edgeoneDomainDeleteSchema,
  edgeoneDomainParamsSchema,
  edgeoneDomainStoreSchema,
  edgeoneJobParamsSchema,
  edgeoneZoneParamsSchema,
} from '../../modules/edge-one/edge-one.schema.js'
import {
  createEdgeOneBatchDeleteHandler,
  createEdgeOneBatchDisableHandler,
  createEdgeOneDomainHandler,
  deleteEdgeOneDomainHandler,
  getActiveEdgeOneBatchJobHandler,
  getEdgeOneBatchJobHandler,
  retryEdgeOneBatchJobHandler,
  syncEdgeOneCnameHandler,
} from './edge-one-dns-sync.handlers.js'

/** EdgeOne lifecycle routes that coordinate provider mutations, jobs, and DNS side effects. */
export async function routes(app: FastifyInstance): Promise<void> {
  app.post('/zones/:zoneId/records', { schema: edgeoneDomainStoreSchema }, createEdgeOneDomainHandler)
  app.delete('/zones/:zoneId/records/:domainName', { schema: edgeoneDomainDeleteSchema }, deleteEdgeOneDomainHandler)
  app.post(
    '/zones/:zoneId/records/:domainName/cname-sync',
    { schema: edgeoneDomainParamsSchema },
    syncEdgeOneCnameHandler
  )

  app.get('/zones/:zoneId/batch/active', { schema: edgeoneZoneParamsSchema }, getActiveEdgeOneBatchJobHandler)
  app.post('/zones/:zoneId/batch/disable', { schema: edgeoneBatchDisableSchema }, createEdgeOneBatchDisableHandler)
  app.post('/zones/:zoneId/batch/delete', { schema: edgeoneBatchDeleteSchema }, createEdgeOneBatchDeleteHandler)
  app.get('/batch/:jobId', { schema: edgeoneJobParamsSchema }, getEdgeOneBatchJobHandler)
  app.post('/batch/:jobId/retry', { schema: edgeoneJobParamsSchema }, retryEdgeOneBatchJobHandler)
}
