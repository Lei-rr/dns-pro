import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { RequestOf } from '../../core/http/request-schema.js'
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
} from '../../modules/cloudflare/saas/saas.schema.js'

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

type JobHandler = (
  request: FastifyRequest<RequestOf<typeof saasJobParamsSchema>>,
  reply: FastifyReply
) => Promise<unknown>

/** 任务查询/重试：两个 job 端点的路径与参数校验完全一致，只有 handler 不同（providerId 由注册前缀提供） */
function jobRoutes(get: JobHandler, retry: JobHandler) {
  return async function registerJobRoutes(app: FastifyInstance) {
    app.get('/:jobId', { schema: saasJobParamsSchema }, get)
    app.post('/:jobId/retry', { schema: saasJobParamsSchema }, retry)
  }
}

export async function routes(app: FastifyInstance) {
  app.register(providerWorkflowRoutes, { prefix: '/providers/:providerId' })
  // 任务端点同 EdgeOne：providerId 落在路径里，归属校验不需要额外的请求参数
  app.register(jobRoutes(getPreferredApplyJobHandler, retryPreferredApplyJobHandler), {
    prefix: '/providers/:providerId/preferred-apply',
  })
  app.register(jobRoutes(getSaaSBatchJobHandler, retrySaaSBatchJobHandler), { prefix: '/providers/:providerId/batch' })
}
