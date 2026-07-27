import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import { asRecord, bodyRecord } from '../../../lib/utils/request-parse.js'
import { zoneNameParam } from './request-params.js'

function hostnamesFromBody(body: Record<string, unknown>): string[] {
  if (Array.isArray(body.hostnames)) return body.hostnames.map(String)
  if (Array.isArray(body.items)) {
    return body.items
      .map((item) => {
        if (item && typeof item === 'object') return String(asRecord(item).hostname ?? '')
        return String(item ?? '')
      })
      .filter(Boolean)
  }
  return []
}

export async function batchDeleteStore(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string } }>,
  reply: FastifyReply,
) {
  const body = bodyRecord(request)
  const result = await request.server.ctx.saasBatchJobService.createDelete({
    providerId: request.params.providerId,
    zoneName: zoneNameParam(request),
    hostnames: hostnamesFromBody(body),
    autoCleanup: body.auto_cleanup === undefined ? true : Boolean(body.auto_cleanup),
  })
  return reply.status(201).send(success(result))
}

export async function batchUpdateStore(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string } }>,
  reply: FastifyReply,
) {
  const body = bodyRecord(request)
  const patchSource =
    body.patch && typeof body.patch === 'object' && !Array.isArray(body.patch)
      ? (body.patch as Record<string, unknown>)
      : body
  const allowed: Record<string, unknown> = {}
  for (const key of ['preferred_domain', 'auto_preferred', 'custom_origin_server', 'method', 'min_tls_version']) {
    if (key in patchSource) allowed[key] = patchSource[key]
  }
  const result = await request.server.ctx.saasBatchJobService.createUpdate({
    providerId: request.params.providerId,
    zoneName: zoneNameParam(request),
    hostnames: hostnamesFromBody(body),
    patch: allowed,
    autoSync: body.auto_sync === undefined ? true : Boolean(body.auto_sync),
  })
  return reply.status(201).send(success(result))
}

export async function batchJobShow(
  request: FastifyRequest<{ Params: { jobId: string } }>,
  reply: FastifyReply,
) {
  const result =
    (await request.server.ctx.saasBatchJobService.find(request.params.jobId)) ||
    (await request.server.ctx.saasPreferredApplyService.find(request.params.jobId))
  return reply.send(success(result))
}

export async function batchJobActive(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string } }>,
  reply: FastifyReply,
) {
  const zone = zoneNameParam(request)
  const result =
    (await request.server.ctx.saasBatchJobService.active(request.params.providerId, zone)) ||
    (await request.server.ctx.saasPreferredApplyService.active(request.params.providerId, zone))
  return reply.send(success(result))
}

export async function batchJobRetry(
  request: FastifyRequest<{ Params: { jobId: string } }>,
  reply: FastifyReply,
) {
  const existing = await request.server.ctx.saasBatchJobService.find(request.params.jobId)
  const result = existing
    ? await request.server.ctx.saasBatchJobService.retryFailed(request.params.jobId)
    : await request.server.ctx.saasPreferredApplyService.retryFailed(request.params.jobId)
  return reply.send(success(result))
}
