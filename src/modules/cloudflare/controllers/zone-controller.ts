import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import { bodyRecord, queryBool, queryInt, queryRecord, queryString } from '../../../lib/utils/request-parse.js'
import { resolveZonePort } from '../../../platform/port-resolve.js'

const PROVIDER_TYPE = 'cloudflare'

export async function zoneIndex(
  request: FastifyRequest<{ Params: { providerId: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const port = resolveZonePort(request.server.ctx.registry, PROVIDER_TYPE)
  const result = await port.list(request.params.providerId, {
    page: queryInt(q, 'page', 1),
    perPage: queryInt(q, 'per_page', 20),
    keyword: queryString(q, 'name') || queryString(q, 'keyword') || undefined,
    refresh: queryBool(q, 'refresh'),
  })
  return reply.send(success(result))
}

export async function zoneStore(
  request: FastifyRequest<{ Params: { providerId: string } }>,
  reply: FastifyReply,
) {
  const body = bodyRecord(request)
  const result = await request.server.ctx.cloudflareZoneService.create(
    request.params.providerId,
    String(body.name ?? body.domain ?? ''),
    String(body.type ?? 'full'),
  )
  return reply.status(201).send(success(result))
}

export async function zoneDelete(
  request: FastifyRequest<{ Params: { providerId: string; zone: string } }>,
  reply: FastifyReply,
) {
  const zoneId = await request.server.ctx.cloudflareZoneService.idByName(
    request.params.providerId,
    request.params.zone,
  )
  const result = await request.server.ctx.cloudflareZoneService.delete(
    request.params.providerId,
    zoneId,
  )
  return reply.send(success(result))
}
