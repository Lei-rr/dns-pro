import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import type {
  CloudflareRecordListQuery,
  CloudflareRecordStoreInput,
  CloudflareRecordUpdateInput,
} from '../schemas/request.js'

export async function recordIndex(
  request: FastifyRequest<{
    Params: { providerId: string; zone: string }
    Querystring: CloudflareRecordListQuery
  }>,
  reply: FastifyReply
) {
  const { providerId, zone } = request.params
  const zoneId = await request.server.ctx.cloudflareZoneService.idByName(providerId, zone)

  const result = await request.server.ctx.cloudflareDnsRecordService.list(providerId, zoneId, request.query)
  return reply.send(success(result))
}

export async function recordStore(
  request: FastifyRequest<{
    Params: { providerId: string; zone: string }
    Body: CloudflareRecordStoreInput
  }>,
  reply: FastifyReply
) {
  const { providerId, zone } = request.params
  const zoneId = await request.server.ctx.cloudflareZoneService.idByName(providerId, zone)

  const result = await request.server.ctx.cloudflareDnsRecordService.create(providerId, zoneId, request.body)
  return reply.status(201).send(success(result))
}

export async function recordUpdate(
  request: FastifyRequest<{
    Params: { providerId: string; zone: string; recordId: string }
    Body: CloudflareRecordUpdateInput
  }>,
  reply: FastifyReply
) {
  const { providerId, zone, recordId } = request.params
  const zoneId = await request.server.ctx.cloudflareZoneService.idByName(providerId, zone)

  const result = await request.server.ctx.cloudflareDnsRecordService.update(providerId, zoneId, recordId, request.body)
  return reply.send(success(result))
}

export async function recordDelete(
  request: FastifyRequest<{ Params: { providerId: string; zone: string; recordId: string } }>,
  reply: FastifyReply
) {
  const { providerId, zone, recordId } = request.params
  const zoneId = await request.server.ctx.cloudflareZoneService.idByName(providerId, zone)

  const result = await request.server.ctx.cloudflareDnsRecordService.delete(providerId, zoneId, recordId)
  return reply.send(success(result))
}
