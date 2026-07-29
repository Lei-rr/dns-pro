import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import { bodyRecord, queryBool, queryRecord } from '../../../lib/utils/request-parse.js'

export async function zonesIndex(
  request: FastifyRequest<{ Params: { providerId: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const result = await request.server.ctx.dnspodZoneService.list(request.params.providerId, {
    refresh: queryBool(q, 'refresh'),
  })
  return reply.send(success(result))
}

export async function zoneStore(
  request: FastifyRequest<{ Params: { providerId: string } }>,
  reply: FastifyReply,
) {
  const body = bodyRecord(request)
  const result = await request.server.ctx.dnspodZoneService.create(
    request.params.providerId,
    String(body.domain ?? body.name ?? ''),
  )
  return reply.status(201).send(success(result))
}

export async function zoneDelete(
  request: FastifyRequest<{ Params: { providerId: string; zone: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.dnspodZoneService.delete(
    request.params.providerId,
    request.params.zone,
  )
  return reply.send(success(result))
}
