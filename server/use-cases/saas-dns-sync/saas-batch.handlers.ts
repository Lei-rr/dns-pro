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
  const { saasBatch, saasPreferredApply } = request.server.ctx.workflows
  const id = request.params.jobId
  return reply.send(success((await saasBatch.find(id)) ?? (await saasPreferredApply.find(id))))
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
  const { saasBatch, saasPreferredApply } = request.server.ctx.workflows
  const id = request.params.jobId
  const result = (await saasBatch.find(id)) ? await saasBatch.retryFailed(id) : await saasPreferredApply.retryFailed(id)
  return reply.send(success(result))
}
