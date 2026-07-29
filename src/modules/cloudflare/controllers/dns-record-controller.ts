import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import { queryBool, queryRecord, bodyRecord } from '../../../lib/utils/request-parse.js'

export async function recordsIndex(
  request: FastifyRequest<{ Params: { providerId: string; zone: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const zoneId = await request.server.ctx.cloudflareZoneService.idByName(
    request.params.providerId,
    request.params.zone,
  )
  const result = await request.server.ctx.cloudflareDnsRecordService.listAll(
    request.params.providerId,
    zoneId,
    queryBool(q, 'refresh'),
  )
  return reply.send(success(result))
}

export async function recordStore(
  request: FastifyRequest<{ Params: { providerId: string; zone: string } }>,
  reply: FastifyReply,
) {
  const zoneId = await request.server.ctx.cloudflareZoneService.idByName(
    request.params.providerId,
    request.params.zone,
  )
  const result = await request.server.ctx.cloudflareDnsRecordService.create(
    request.params.providerId,
    zoneId,
    bodyRecord(request),
  )
  return reply.status(201).send(success(result))
}

export async function recordUpdate(
  request: FastifyRequest<{ Params: { providerId: string; zone: string; recordId: string } }>,
  reply: FastifyReply,
) {
  const zoneId = await request.server.ctx.cloudflareZoneService.idByName(
    request.params.providerId,
    request.params.zone,
  )
  const result = await request.server.ctx.cloudflareDnsRecordService.update(
    request.params.providerId,
    zoneId,
    request.params.recordId,
    bodyRecord(request),
  )
  return reply.send(success(result))
}

export async function recordDelete(
  request: FastifyRequest<{ Params: { providerId: string; zone: string; recordId: string } }>,
  reply: FastifyReply,
) {
  const zoneId = await request.server.ctx.cloudflareZoneService.idByName(
    request.params.providerId,
    request.params.zone,
  )
  const result = await request.server.ctx.cloudflareDnsRecordService.delete(
    request.params.providerId,
    zoneId,
    request.params.recordId,
  )
  return reply.send(success(result))
}
