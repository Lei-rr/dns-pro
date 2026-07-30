import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import { queryBool, queryRecord } from '../../../lib/utils/request-parse.js'

export async function zonesIndex(
  request: FastifyRequest<{ Params: { providerId: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const result = await request.server.ctx.edgeoneZoneService.zones(
    request.params.providerId,
    queryBool(q, 'refresh'),
  )
  return reply.send(success(result))
}

export async function zoneShow(
  request: FastifyRequest<{ Params: { providerId: string; zoneId: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const result = await request.server.ctx.edgeoneZoneService.zoneById(
    request.params.providerId,
    request.params.zoneId,
    queryBool(q, 'refresh'),
  )
  return reply.send(success(result))
}
