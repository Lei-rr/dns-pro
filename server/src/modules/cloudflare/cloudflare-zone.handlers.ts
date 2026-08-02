import type { FastifyReply, FastifyRequest } from 'fastify'
import { success } from '../../shared/http/api-response.js'
import type { RequestOf } from '../../shared/http/request-schema.js'
import {
  cloudflareZoneParamsSchema,
  cloudflareZonesIndexSchema,
  cloudflareZoneStoreSchema,
} from './cloudflare.schema.js'

export async function listCloudflareZonesHandler(
  request: FastifyRequest<RequestOf<typeof cloudflareZonesIndexSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.cloudflare.zones.listAll(
    request.params.providerId,
    request.query.refresh === 'true'
  )
  return reply.send(success(result))
}

export async function createCloudflareZoneHandler(
  request: FastifyRequest<RequestOf<typeof cloudflareZoneStoreSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.cloudflare.zones.create(request.params.providerId, request.body.name)
  return reply.status(201).send(success(result))
}

export async function deleteCloudflareZoneHandler(
  request: FastifyRequest<RequestOf<typeof cloudflareZoneParamsSchema>>,
  reply: FastifyReply
) {
  const zoneId = await request.server.ctx.modules.cloudflare.zones.idByName(
    request.params.providerId,
    request.params.zone
  )
  const result = await request.server.ctx.modules.cloudflare.zones.delete(request.params.providerId, zoneId)
  return reply.send(success(result))
}
