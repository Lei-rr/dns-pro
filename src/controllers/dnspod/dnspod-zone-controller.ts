import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../support/api-response.js'
import { DnsPodZoneService } from '../../services/dnspod/dnspod-zone-service.js'
import type { ZoneListQuery, ZoneStoreInput } from '../../schemas/dnspod.js'

const zoneService = new DnsPodZoneService()

export async function zoneIndex(
  request: FastifyRequest<{ Params: { providerId: string }; Querystring: ZoneListQuery }>,
  reply: FastifyReply
) {
  const result = await zoneService.list(request.params.providerId, request.query)
  return reply.send(success(result))
}

export async function zoneStore(
  request: FastifyRequest<{ Params: { providerId: string }; Body: ZoneStoreInput }>,
  reply: FastifyReply
) {
  const result = await zoneService.create(request.params.providerId, request.body.domain)
  return reply.status(201).send(success(result))
}

export async function zoneDelete(
  request: FastifyRequest<{ Params: { providerId: string; zone: string } }>,
  reply: FastifyReply
) {
  const result = await zoneService.delete(request.params.providerId, request.params.zone)
  return reply.send(success(result))
}
