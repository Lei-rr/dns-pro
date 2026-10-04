import type { FastifyReply, FastifyRequest } from 'fastify'
import { success } from '../../core/http/api-response.js'
import { trimmedParam } from '../../core/http/route-params.js'
import type { RequestOf } from '../../core/http/request-schema.js'
import { auditActor } from '../../core/observability/audit-log.js'
import {
  saasBatchDeleteSchema,
  saasBatchUpdateSchema,
  saasJobParamsSchema,
  saasZoneParamsSchema,
} from '../../modules/cloudflare/saas/saas.schema.js'

export async function createSaaSBatchDeleteHandler(
  request: FastifyRequest<RequestOf<typeof saasBatchDeleteSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.workflows.saasBatch.createDelete({
    providerId: request.params.providerId,
    zoneName: trimmedParam(request, 'zoneName'),
    hostnames: request.body.hostnames,
    autoCleanup: request.body.auto_cleanup ?? true,
  })
  request.server.ctx.platform.audit.record({
    action: 'batch',
    actor: await auditActor(request),
    target: `saas:${request.params.providerId}/${trimmedParam(request, 'zoneName')}`,
    detail: { operation: 'delete', job_id: result.id, hostnames: request.body.hostnames.length },
  })
  return reply.status(201).send(success(result))
}

export async function createSaaSBatchUpdateHandler(
  request: FastifyRequest<RequestOf<typeof saasBatchUpdateSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.workflows.saasBatch.createUpdate({
    providerId: request.params.providerId,
    zoneName: trimmedParam(request, 'zoneName'),
    hostnames: request.body.hostnames,
    patch: request.body.patch,
    autoSync: request.body.auto_sync ?? true,
  })
  request.server.ctx.platform.audit.record({
    action: 'batch',
    actor: await auditActor(request),
    target: `saas:${request.params.providerId}/${trimmedParam(request, 'zoneName')}`,
    detail: { operation: 'update', job_id: result.id, hostnames: request.body.hostnames.length },
  })
  return reply.status(201).send(success(result))
}

export async function getSaaSBatchJobHandler(
  request: FastifyRequest<RequestOf<typeof saasJobParamsSchema>>,
  reply: FastifyReply
) {
  // 任务类型与端点一一对应：不做跨类型兜底，否则同一 jobId 会按端点返回不同任务
  return reply.send(success(await request.server.ctx.workflows.saasBatch.find(request.params.jobId)))
}

export async function getActiveSaaSBatchJobHandler(
  request: FastifyRequest<RequestOf<typeof saasZoneParamsSchema>>,
  reply: FastifyReply
) {
  const { saasBatch, saasPreferredApply } = request.server.ctx.workflows
  const zone = trimmedParam(request, 'zoneName')
  const result =
    (await saasBatch.active(request.params.providerId, zone)) ??
    (await saasPreferredApply.active(request.params.providerId, zone))
  return reply.send(success(result))
}

export async function retrySaaSBatchJobHandler(
  request: FastifyRequest<RequestOf<typeof saasJobParamsSchema>>,
  reply: FastifyReply
) {
  // 未命中时由本族抛出 batch_job_not_found，避免跨类型兜底给出另一族的错误码
  const result = await request.server.ctx.workflows.saasBatch.retryFailed(request.params.jobId)
  return reply.send(success(result))
}
