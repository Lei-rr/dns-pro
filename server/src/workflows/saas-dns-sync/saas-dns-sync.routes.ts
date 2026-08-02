import type { FastifyInstance } from 'fastify'
import {
  deleteSaaSHostnameHandler,
  reconcileSaaSHostnameHandler,
  repairSaaSHostnameDnsHandler,
  createSaaSHostnameHandler,
  updateSaaSHostnameHandler,
} from './saas-dns-sync.handlers.js'
import {
  createSaaSBatchDeleteHandler,
  getActiveSaaSBatchJobHandler,
  retrySaaSBatchJobHandler,
  getSaaSBatchJobHandler,
  createSaaSBatchUpdateHandler,
} from './saas-batch.handlers.js'
import {
  getActivePreferredApplyJobHandler,
  previewPreferredApplyHandler,
  retryPreferredApplyJobHandler,
  getPreferredApplyJobHandler,
  createPreferredApplyHandler,
} from './preferred-apply.handlers.js'
import {
  saasBatchDeleteSchema,
  saasBatchUpdateSchema,
  saasHostnameDeleteSchema,
  saasHostnameParamsSchema,
  saasHostnameStoreSchema,
  saasHostnameUpdateSchema,
  saasJobParamsSchema,
  saasPreferredApplySchema,
  saasZoneParamsSchema,
} from '../../modules/saas/saas.schema.js'

async function providerWorkflowRoutes(app: FastifyInstance) {
  app.post('/zones/:zoneName/hostnames', { schema: saasHostnameStoreSchema }, createSaaSHostnameHandler)
  app.put('/zones/:zoneName/hostnames/:hostnameFqdn', { schema: saasHostnameUpdateSchema }, updateSaaSHostnameHandler)
  app.delete(
    '/zones/:zoneName/hostnames/:hostnameFqdn',
    { schema: saasHostnameDeleteSchema },
    deleteSaaSHostnameHandler
  )
  app.post(
    '/zones/:zoneName/hostnames/:hostnameFqdn/reconcile',
    { schema: saasHostnameParamsSchema },
    reconcileSaaSHostnameHandler
  )
  app.post(
    '/zones/:zoneName/hostnames/:hostnameFqdn/dns-repair',
    { schema: saasHostnameParamsSchema },
    repairSaaSHostnameDnsHandler
  )
  app.get(
    '/zones/:zoneName/preferred-apply/active',
    { schema: saasZoneParamsSchema },
    getActivePreferredApplyJobHandler
  )
  app.post(
    '/zones/:zoneName/preferred-apply/preview',
    { schema: saasPreferredApplySchema },
    previewPreferredApplyHandler
  )
  app.post('/zones/:zoneName/preferred-apply', { schema: saasPreferredApplySchema }, createPreferredApplyHandler)
  app.get('/zones/:zoneName/batch/active', { schema: saasZoneParamsSchema }, getActiveSaaSBatchJobHandler)
  app.post('/zones/:zoneName/batch/delete', { schema: saasBatchDeleteSchema }, createSaaSBatchDeleteHandler)
  app.post('/zones/:zoneName/batch/update', { schema: saasBatchUpdateSchema }, createSaaSBatchUpdateHandler)
}

async function preferredApplyJobRoutes(app: FastifyInstance) {
  app.get('/:jobId', { schema: saasJobParamsSchema }, getPreferredApplyJobHandler)
  app.post('/:jobId/retry', { schema: saasJobParamsSchema }, retryPreferredApplyJobHandler)
}

async function batchJobRoutes(app: FastifyInstance) {
  app.get('/:jobId', { schema: saasJobParamsSchema }, getSaaSBatchJobHandler)
  app.post('/:jobId/retry', { schema: saasJobParamsSchema }, retrySaaSBatchJobHandler)
}

export async function routes(app: FastifyInstance) {
  app.register(providerWorkflowRoutes, { prefix: '/providers/:providerId' })
  app.register(preferredApplyJobRoutes, { prefix: '/preferred-apply' })
  app.register(batchJobRoutes, { prefix: '/batch' })
}
