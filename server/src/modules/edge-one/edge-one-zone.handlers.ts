import type { FastifyReply, FastifyRequest } from 'fastify'
import { success } from '../../shared/http/api-response.js'
import type { RequestOf } from '../../shared/http/request-schema.js'
import { edgeoneZonesIndexSchema, edgeoneZoneShowSchema } from './edge-one.schema.js'

export async function listEdgeOneZonesHandler(
  request: FastifyRequest<RequestOf<typeof edgeoneZonesIndexSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.edgeOne.zones.zones(
    request.params.providerId,
    request.query.refresh === 'true'
  )
  return reply.send(success(result))
}

export async function getEdgeOneZoneHandler(
  request: FastifyRequest<RequestOf<typeof edgeoneZoneShowSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.edgeOne.zones.zoneById(
    request.params.providerId,
    request.params.zoneId,
    request.query.refresh === 'true'
  )
  return reply.send(success(result))
}
