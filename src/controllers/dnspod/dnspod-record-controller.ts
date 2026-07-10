import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../support/api-response.js'
import { DnsPodRecordService } from '../../services/dnspod/dnspod-record-service.js'
import type { RecordListQuery, RecordStoreInput, RecordUpdateInput } from '../../schemas/dnspod.js'

const recordService = new DnsPodRecordService()

export async function recordIndex(
  request: FastifyRequest<{ Params: { providerId: string; zone: string }; Querystring: RecordListQuery }>,
  reply: FastifyReply
) {
  const result = await recordService.list(request.params.providerId, request.params.zone, request.query)
  return reply.send(success(result))
}

export async function recordStore(
  request: FastifyRequest<{ Params: { providerId: string; zone: string }; Body: RecordStoreInput }>,
  reply: FastifyReply
) {
  const result = await recordService.create(request.params.providerId, request.params.zone, request.body)
  return reply.status(201).send(success(result))
}

export async function recordUpdate(
  request: FastifyRequest<{
    Params: { providerId: string; zone: string; recordId: string }
    Body: RecordUpdateInput
  }>,
  reply: FastifyReply
) {
  const result = await recordService.update(
    request.params.providerId,
    request.params.zone,
    request.params.recordId,
    request.body
  )
  return reply.send(success(result))
}

export async function recordDelete(
  request: FastifyRequest<{ Params: { providerId: string; zone: string; recordId: string } }>,
  reply: FastifyReply
) {
  const result = await recordService.delete(request.params.providerId, request.params.zone, request.params.recordId)
  return reply.send(success(result))
}
