import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import { asRecord, bodyRecord } from '../../../lib/utils/request-parse.js'

function domainList(body: Record<string, unknown>): string[] {
  if (Array.isArray(body.domains)) return body.domains.map(String)
  if (Array.isArray(body.items)) {
    return body.items.map((item) => {
      if (item && typeof item === 'object') {
        const row = asRecord(item)
        return String(row.domain ?? row.name ?? '')
      }
      return String(item ?? '')
    }).filter(Boolean)
  }
  return []
}

export async function edgeOneBatchDisableStore(
  request: FastifyRequest<{ Params: { providerId: string; zoneId: string } }>,
  reply: FastifyReply,
) {
  const body = bodyRecord(request)
  const result = await request.server.ctx.edgeoneBatchJobService.createDisable({
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
  const result = await request.server.ctx.edgeoneBatchJobService.createDelete({
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
  const result = await request.server.ctx.edgeoneBatchJobService.find(request.params.jobId)
  return reply.send(success(result))
}

export async function edgeOneBatchJobActive(
  request: FastifyRequest<{ Params: { providerId: string; zoneId: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.edgeoneBatchJobService.active(
    request.params.providerId,
    request.params.zoneId,
  )
  return reply.send(success(result))
}

export async function edgeOneBatchJobRetry(
  request: FastifyRequest<{ Params: { jobId: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.edgeoneBatchJobService.retryFailed(request.params.jobId)
  return reply.send(success(result))
}
