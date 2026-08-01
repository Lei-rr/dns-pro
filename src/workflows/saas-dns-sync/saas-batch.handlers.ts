import type { FastifyReply, FastifyRequest } from 'fastify'
import { success } from '../../shared/http/api-response.js'
import type { RequestOf } from '../../shared/http/request-schema.js'
import { zoneNameParam } from '../../modules/saas/saas-request-params.js'
import {
  saasBatchDeleteSchema,
  saasBatchUpdateSchema,
  saasJobParamsSchema,
  saasZoneParamsSchema,
} from '../../modules/saas/saas.schema.js'

export async function createSaaSBatchDeleteHandler(
  request: FastifyRequest<RequestOf<typeof saasBatchDeleteSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.workflows.saasBatch.createDelete({
    providerId: request.params.providerId,
    zoneName: zoneNameParam(request),
    hostnames: request.body.hostnames,
    autoCleanup: request.body.auto_cleanup ?? true,
  })
  return reply.status(201).send(success(result))
}

export async function createSaaSBatchUpdateHandler(
  request: FastifyRequest<RequestOf<typeof saasBatchUpdateSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.workflows.saasBatch.createUpdate({
    providerId: request.params.providerId,
    zoneName: zoneNameParam(request),
    hostnames: request.body.hostnames,
    patch: request.body.patch,
    autoSync: request.body.auto_sync ?? true,
  })
  return reply.status(201).send(success(result))
}

export async function getSaaSBatchJobHandler(
  request: FastifyRequest<RequestOf<typeof saasJobParamsSchema>>,
  reply: FastifyReply
) {
  const result =
    (await request.server.ctx.workflows.saasBatch.find(request.params.jobId)) ||
    (await request.server.ctx.workflows.saasPreferredApply.find(request.params.jobId))
  return reply.send(success(result))
}

export async function getActiveSaaSBatchJobHandler(
  request: FastifyRequest<RequestOf<typeof saasZoneParamsSchema>>,
  reply: FastifyReply
) {
  const zone = zoneNameParam(request)
  const result =
    (await request.server.ctx.workflows.saasBatch.active(request.params.providerId, zone)) ||
    (await request.server.ctx.workflows.saasPreferredApply.active(request.params.providerId, zone))
  return reply.send(success(result))
}

export async function retrySaaSBatchJobHandler(
  request: FastifyRequest<RequestOf<typeof saasJobParamsSchema>>,
  reply: FastifyReply
) {
  const existing = await request.server.ctx.workflows.saasBatch.find(request.params.jobId)
  const result = existing
    ? await request.server.ctx.workflows.saasBatch.retryFailed(request.params.jobId)
    : await request.server.ctx.workflows.saasPreferredApply.retryFailed(request.params.jobId)
  return reply.send(success(result))
}
