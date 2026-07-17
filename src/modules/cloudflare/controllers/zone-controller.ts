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
  request: FastifyRequest<{ Params: { providerId: string }; Body: any }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.dnsZoneMutationUseCase.create(
    PROVIDER_TYPE,
    request.params.providerId,
    bodyRecord(request),
  )
  return reply.status(201).send(success(result))
}

export async function zoneDelete(
  request: FastifyRequest<{ Params: { providerId: string; zone: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.dnsZoneMutationUseCase.delete(
    PROVIDER_TYPE,
    request.params.providerId,
    request.params.zone,
  )
  return reply.send(success(result))
}
