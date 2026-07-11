import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import { parseBool } from '../../../lib/utils/parse-bool.js'
import type { EdgeOneZoneListInput, EdgeOneZoneShowInput } from '../schemas/request.js'

export async function edgeOneZonesIndex(
  request: FastifyRequest<{ Params: { providerId: string }; Querystring: EdgeOneZoneListInput }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.edgeoneZoneService.zones(
    request.params.providerId,
    request.query.offset ?? 0,
    request.query.limit ?? 20,
    parseBool(request.query.refresh)
  )
  return reply.send(success(result))
}

export async function edgeOneZoneShow(
  request: FastifyRequest<{ Params: { providerId: string; zoneId: string }; Querystring: EdgeOneZoneShowInput }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.edgeoneZoneService.zoneById(
    request.params.providerId,
    request.params.zoneId
  )
  return reply.send(success(result))
}
