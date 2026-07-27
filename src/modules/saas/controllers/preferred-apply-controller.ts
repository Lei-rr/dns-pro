import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import { bodyRecord } from '../../../lib/utils/request-parse.js'
import { zoneNameParam } from './request-params.js'

export async function preferredApplyPreview(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string } }>,
  reply: FastifyReply,
) {
  const body = bodyRecord(request)
  const result = await request.server.ctx.saasPreferredApplyService.preview({
    providerId: request.params.providerId,
    zoneName: zoneNameParam(request),
    preferredDomain: String(body.preferred_domain ?? ''),
    hostnames: Array.isArray(body.hostnames) ? body.hostnames.map(String) : undefined,
    onlyAutoPreferred: Boolean(body.only_auto_preferred),
  })
  return reply.send(success(result))
}

export async function preferredApplyStore(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string } }>,
  reply: FastifyReply,
) {
  const body = bodyRecord(request)
  const result = await request.server.ctx.saasPreferredApplyService.create({
    providerId: request.params.providerId,
    zoneName: zoneNameParam(request),
    preferredDomain: String(body.preferred_domain ?? ''),
    hostnames: Array.isArray(body.hostnames) ? body.hostnames.map(String) : undefined,
    onlyAutoPreferred: Boolean(body.only_auto_preferred),
    dryRun: Boolean(body.dry_run),
  })
  return reply.status(201).send(success(result))
}

export async function preferredApplyShow(
  request: FastifyRequest<{ Params: { jobId: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.saasPreferredApplyService.find(request.params.jobId)
  return reply.send(success(result))
}

export async function preferredApplyActive(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.saasPreferredApplyService.active(
    request.params.providerId,
    zoneNameParam(request),
  )
  return reply.send(success(result))
}

export async function preferredApplyRetry(
  request: FastifyRequest<{ Params: { jobId: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.saasPreferredApplyService.retryFailed(request.params.jobId)
  return reply.send(success(result))
}
