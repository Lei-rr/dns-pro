import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import { bodyRecord } from '../../../lib/utils/request-parse.js'
import { EdgeOneServiceTokens } from '../plugin.js'
import type { EdgeOneBatchJobService } from '../services/batch-job-service.js'

function batchOf(request: FastifyRequest): EdgeOneBatchJobService {
  return request.server.ctx.registry.require<EdgeOneBatchJobService>(EdgeOneServiceTokens.BatchJob)
}

function domainList(body: Record<string, unknown>): string[] {
  if (Array.isArray(body.domains)) return body.domains.map(String)
  if (Array.isArray(body.items)) {
    return body.items.map((item) => String((item as any)?.domain ?? (item as any)?.name ?? item))
  }
  return []
}

export async function edgeOneBatchDisableStore(
  request: FastifyRequest<{ Params: { providerId: string; zoneId: string } }>,
  reply: FastifyReply,
) {
  const body = bodyRecord(request)
  const result = await batchOf(request).createDisable({
    providerId: request.params.providerId,
    zoneId: request.params.zoneId,
    domains: domainList(body),
  })
  return reply.status(201).send(success(result))
}

export async function edgeOneBatchDeleteStore(
  request: FastifyRequest<{ Params: { providerId: string; zoneId: string } }>,
  reply: FastifyReply,
) {
  const body = bodyRecord(request)
  const result = await batchOf(request).createDelete({
    providerId: request.params.providerId,
    zoneId: request.params.zoneId,
    domains: domainList(body),
    autoCleanup: body.auto_cleanup === undefined ? true : Boolean(body.auto_cleanup),
  })
  return reply.status(201).send(success(result))
}

export async function edgeOneBatchJobShow(
  request: FastifyRequest<{ Params: { jobId: string } }>,
  reply: FastifyReply,
) {
  const result = await batchOf(request).find(request.params.jobId)
  return reply.send(success(result))
}

export async function edgeOneBatchJobActive(
  request: FastifyRequest<{ Params: { providerId: string; zoneId: string } }>,
  reply: FastifyReply,
) {
  const result = await batchOf(request).active(request.params.providerId, request.params.zoneId)
  return reply.send(success(result))
}

export async function edgeOneBatchJobRetry(
  request: FastifyRequest<{ Params: { jobId: string } }>,
  reply: FastifyReply,
) {
  const result = await batchOf(request).retryFailed(request.params.jobId)
  return reply.send(success(result))
}
