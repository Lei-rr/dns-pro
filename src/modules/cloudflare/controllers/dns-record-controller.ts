import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import { queryBool, queryInt, queryRecord, queryString } from '../../../lib/utils/request-parse.js'
import { resolveRecordPort } from '../../../platform/port-resolve.js'

const PROVIDER_TYPE = 'cloudflare'

export async function recordIndex(
  request: FastifyRequest<{ Params: { providerId: string; zone: string } }>,
  reply: FastifyReply,
) {
  const { providerId, zone } = request.params
  // Cloudflare APIs use zone id; keep name resolution at controller edge.
  const zoneId = await request.server.ctx.cloudflareZoneService.idByName(providerId, zone)
  const q = queryRecord(request)
  const port = resolveRecordPort(request.server.ctx.registry, PROVIDER_TYPE)
  const result = await port.list(providerId, zoneId, {
    page: queryInt(q, 'page', 1),
    perPage: queryInt(q, 'per_page', 100),
    type: queryString(q, 'type') || undefined,
    keyword: queryString(q, 'search') || queryString(q, 'keyword') || undefined,
    refresh: queryBool(q, 'refresh'),
  })
  return reply.send(success(result))
}

export async function recordStore(
  request: FastifyRequest<{ Params: { providerId: string; zone: string }; Body: any }>,
  reply: FastifyReply,
) {
  const { providerId, zone } = request.params
  const zoneId = await request.server.ctx.cloudflareZoneService.idByName(providerId, zone)
  const result = await request.server.ctx.cloudflareDnsRecordService.create(
    providerId,
    zoneId,
    (request.body ?? {}) as any,
  )
  return reply.status(201).send(success(result))
}

export async function recordUpdate(
  request: FastifyRequest<{ Params: { providerId: string; zone: string; recordId: string }; Body: any }>,
  reply: FastifyReply,
) {
  const { providerId, zone, recordId } = request.params
  const zoneId = await request.server.ctx.cloudflareZoneService.idByName(providerId, zone)
  const result = await request.server.ctx.cloudflareDnsRecordService.update(
    providerId,
    zoneId,
    recordId,
    (request.body ?? {}) as any,
  )
  return reply.send(success(result))
}

export async function recordDelete(
  request: FastifyRequest<{ Params: { providerId: string; zone: string; recordId: string } }>,
  reply: FastifyReply,
) {
  const { providerId, zone, recordId } = request.params
  const zoneId = await request.server.ctx.cloudflareZoneService.idByName(providerId, zone)
  const result = await request.server.ctx.cloudflareDnsRecordService.delete(providerId, zoneId, recordId)
  return reply.send(success(result))
}
