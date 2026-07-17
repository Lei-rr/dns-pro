import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import { queryBool, queryInt, queryRecord, queryString, bodyRecord } from '../../../lib/utils/request-parse.js'
import { resolveRecordPort } from '../../../platform/port-resolve.js'

const PROVIDER_TYPE = 'cloudflare'

export async function recordIndex(
  request: FastifyRequest<{ Params: { providerId: string; zone: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const port = resolveRecordPort(request.server.ctx.registry, PROVIDER_TYPE)
  const result = await port.list(request.params.providerId, request.params.zone, {
    page: queryInt(q, 'page', 1),
    perPage: queryInt(q, 'per_page', 100),
    type: queryString(q, 'type') || undefined,
    keyword: queryString(q, 'search') || queryString(q, 'keyword') || undefined,
    refresh: queryBool(q, 'refresh'),
  })
  return reply.send(success(result))
}

export async function recordStore(
  request: FastifyRequest<{ Params: { providerId: string; zone: string } }>,
  reply: FastifyReply,
) {
  const zoneId = await request.server.ctx.cloudflareZoneService.idByName(
    request.params.providerId,
    request.params.zone,
  )
  const result = await request.server.ctx.cloudflareDnsRecordService.create(
    request.params.providerId,
    zoneId,
    bodyRecord(request) as any,
  )
  return reply.status(201).send(success(result))
}

export async function recordUpdate(
  request: FastifyRequest<{ Params: { providerId: string; zone: string; recordId: string } }>,
  reply: FastifyReply,
) {
  const zoneId = await request.server.ctx.cloudflareZoneService.idByName(
    request.params.providerId,
    request.params.zone,
  )
  const result = await request.server.ctx.cloudflareDnsRecordService.update(
    request.params.providerId,
    zoneId,
    request.params.recordId,
    bodyRecord(request) as any,
  )
  return reply.send(success(result))
}

export async function recordDelete(
  request: FastifyRequest<{ Params: { providerId: string; zone: string; recordId: string } }>,
  reply: FastifyReply,
) {
  const zoneId = await request.server.ctx.cloudflareZoneService.idByName(
    request.params.providerId,
    request.params.zone,
  )
  const result = await request.server.ctx.cloudflareDnsRecordService.delete(
    request.params.providerId,
    zoneId,
    request.params.recordId,
  )
  return reply.send(success(result))
}
