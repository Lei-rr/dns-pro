import type { FastifyRequest, FastifyReply } from 'fastify'
import { EdgeOneZoneService } from '../../services/edgeone/edgeone-zone-service.js'
import { success } from '../../support/api-response.js'
import type { EdgeOneZoneListInput, EdgeOneZoneShowInput } from '../../schemas/edgeone.js'

const zoneService = new EdgeOneZoneService()

function parseBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true'
  return false
}

export async function edgeOneZonesIndex(
  request: FastifyRequest<{ Params: { providerId: string }; Querystring: EdgeOneZoneListInput }>,
  reply: FastifyReply
) {
  const result = await zoneService.zones(
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
  const result = await zoneService.zoneById(request.params.providerId, request.params.zoneId)
  return reply.send(success(result))
}
