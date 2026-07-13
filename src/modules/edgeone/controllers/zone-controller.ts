import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import { parseBool } from '../../../lib/utils/parse-bool.js'


export async function edgeOneZonesIndex(
  request: FastifyRequest<{ Params: { providerId: string }; Querystring: any }>,
  reply: FastifyReply
) {
  const q: any = request.query ?? {}
  const result = await request.server.ctx.edgeoneZoneService.zones(
    request.params.providerId,
    q.offset ?? 0,
    q.limit ?? 20,
    parseBool(q.refresh)
  )
  return reply.send(success(result))
}

export async function edgeOneZoneShow(
  request: FastifyRequest<{ Params: { providerId: string; zoneId: string }; Querystring: any }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.edgeoneZoneService.zoneById(
    request.params.providerId,
    request.params.zoneId
  )
  return reply.send(success(result))
}
