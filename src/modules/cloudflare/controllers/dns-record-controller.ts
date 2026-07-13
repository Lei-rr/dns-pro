import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'

export async function recordIndex(
  request: FastifyRequest<{ Params: { providerId: string; zone: string }; Querystring: any }>,
  reply: FastifyReply
) {
  const { providerId, zone } = request.params
  const zoneId = await request.server.ctx.cloudflareZoneService.idByName(providerId, zone)
  const result = await request.server.ctx.cloudflareDnsRecordService.list(providerId, zoneId, (request.query ?? {}) as any)
  return reply.send(success(result))
}

export async function recordStore(
  request: FastifyRequest<{ Params: { providerId: string; zone: string }; Body: any }>,
  reply: FastifyReply
) {
  const { providerId, zone } = request.params
  const zoneId = await request.server.ctx.cloudflareZoneService.idByName(providerId, zone)
  const result = await request.server.ctx.cloudflareDnsRecordService.create(providerId, zoneId, (request.body ?? {}) as any)
  return reply.status(201).send(success(result))
}

export async function recordUpdate(
  request: FastifyRequest<{ Params: { providerId: string; zone: string; recordId: string }; Body: any }>,
  reply: FastifyReply
) {
  const { providerId, zone, recordId } = request.params
  const zoneId = await request.server.ctx.cloudflareZoneService.idByName(providerId, zone)
  const result = await request.server.ctx.cloudflareDnsRecordService.update(providerId, zoneId, recordId, (request.body ?? {}) as any)
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
