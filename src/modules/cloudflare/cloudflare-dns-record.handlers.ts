import type { FastifyReply, FastifyRequest } from 'fastify'
import { success } from '../../shared/http/api-response.js'
import type { RequestOf } from '../../shared/http/request-schema.js'
import {
  cloudflareRecordParamsSchema,
  cloudflareRecordsIndexSchema,
  cloudflareRecordUpdateSchema,
  cloudflareRecordWriteSchema,
} from './cloudflare.schema.js'

export async function listCloudflareRecordsHandler(
  request: FastifyRequest<RequestOf<typeof cloudflareRecordsIndexSchema>>,
  reply: FastifyReply
) {
  const zoneId = await request.server.ctx.modules.cloudflare.zones.idByName(
    request.params.providerId,
    request.params.zone
  )
  const result = await request.server.ctx.modules.cloudflare.records.listAll(
    request.params.providerId,
    zoneId,
    request.query.refresh === 'true'
  )
  return reply.send(success(result))
}

export async function createCloudflareRecordHandler(
  request: FastifyRequest<RequestOf<typeof cloudflareRecordWriteSchema>>,
  reply: FastifyReply
) {
  const zoneId = await request.server.ctx.modules.cloudflare.zones.idByName(
    request.params.providerId,
    request.params.zone
  )
  const result = await request.server.ctx.modules.cloudflare.records.create(
    request.params.providerId,
    zoneId,
    request.body
  )
  return reply.status(201).send(success(result))
}

export async function updateCloudflareRecordHandler(
  request: FastifyRequest<RequestOf<typeof cloudflareRecordUpdateSchema>>,
  reply: FastifyReply
) {
  const zoneId = await request.server.ctx.modules.cloudflare.zones.idByName(
    request.params.providerId,
    request.params.zone
  )
  const result = await request.server.ctx.modules.cloudflare.records.update(
    request.params.providerId,
    zoneId,
    request.params.recordId,
    request.body
  )
  return reply.send(success(result))
}

export async function deleteCloudflareRecordHandler(
  request: FastifyRequest<RequestOf<typeof cloudflareRecordParamsSchema>>,
  reply: FastifyReply
) {
  const zoneId = await request.server.ctx.modules.cloudflare.zones.idByName(
    request.params.providerId,
    request.params.zone
  )
  const result = await request.server.ctx.modules.cloudflare.records.delete(
    request.params.providerId,
    zoneId,
    request.params.recordId
  )
  return reply.send(success(result))
}
