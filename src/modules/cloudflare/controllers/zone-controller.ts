import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import type {
  CloudflareZoneListQuery,
  CloudflareZoneStoreInput,
} from '../schemas/request.js'

export async function zoneIndex(
  request: FastifyRequest<{ Params: { providerId: string }; Querystring: CloudflareZoneListQuery }>,
  reply: FastifyReply
) {
  const { providerId } = request.params
  const { page, per_page, name, refresh } = request.query

  const result = await request.server.ctx.cloudflareZoneService.list(providerId, page, per_page, name, refresh)
  return reply.send(success(result))
}

export async function zoneStore(
  request: FastifyRequest<{ Params: { providerId: string }; Body: CloudflareZoneStoreInput }>,
  reply: FastifyReply
) {
  const { providerId } = request.params
  const { name, type } = request.body

  const result = await request.server.ctx.cloudflareZoneService.create(providerId, name.toLowerCase().trim(), type)
  return reply.status(201).send(success(result))
}

export async function zoneDelete(
  request: FastifyRequest<{ Params: { providerId: string; zone: string } }>,
  reply: FastifyReply
) {
  const { providerId, zone } = request.params
  const zoneId = await request.server.ctx.cloudflareZoneService.idByName(providerId, zone)

  const result = await request.server.ctx.cloudflareZoneService.delete(providerId, zoneId)
  return reply.send(success(result))
}
