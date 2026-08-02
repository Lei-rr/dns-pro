import type { FastifyReply, FastifyRequest } from 'fastify'
import { success } from '../../shared/http/api-response.js'
import type { RequestOf } from '../../shared/http/request-schema.js'
import { dnspodZoneParamsSchema, dnspodZonesIndexSchema, dnspodZoneStoreSchema } from './dns-pod.schema.js'

export async function listDnsPodZonesHandler(
  request: FastifyRequest<RequestOf<typeof dnspodZonesIndexSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.dnsPod.zones.list(request.params.providerId, {
    refresh: request.query.refresh === 'true',
  })
  return reply.send(success(result))
}

export async function createDnsPodZoneHandler(
  request: FastifyRequest<RequestOf<typeof dnspodZoneStoreSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.dnsPod.zones.create(request.params.providerId, request.body.domain)
  return reply.status(201).send(success(result))
}

export async function deleteDnsPodZoneHandler(
  request: FastifyRequest<RequestOf<typeof dnspodZoneParamsSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.dnsPod.zones.delete(request.params.providerId, request.params.zone)
  return reply.send(success(result))
}
