import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import { parseBool } from '../../../lib/utils/parse-bool.js'
import { EdgeOneServiceTokens } from '../plugin.js'
import type { EdgeOneZoneService } from '../services/zone-service.js'

export async function edgeOneZonesIndex(
  request: FastifyRequest<{ Params: { providerId: string }; Querystring: any }>,
  reply: FastifyReply,
) {
  const zones = request.server.ctx.registry.require<EdgeOneZoneService>(EdgeOneServiceTokens.Zones)
  const q: any = request.query ?? {}
  const result = await zones.zones(request.params.providerId, parseBool(q.refresh))
  return reply.send(success(result))
}

export async function edgeOneZoneShow(
  request: FastifyRequest<{ Params: { providerId: string; zoneId: string }; Querystring: any }>,
  reply: FastifyReply,
) {
  const zones = request.server.ctx.registry.require<EdgeOneZoneService>(EdgeOneServiceTokens.Zones)
  const result = await zones.zoneById(request.params.providerId, request.params.zoneId)
  return reply.send(success(result))
}
