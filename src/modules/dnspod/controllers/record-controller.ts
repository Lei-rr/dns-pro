import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import { queryBool, queryRecord, bodyRecord } from '../../../lib/utils/request-parse.js'

export async function recordsIndex(
  request: FastifyRequest<{ Params: { providerId: string; zone: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const result = await request.server.ctx.dnspodRecordService.list(
    request.params.providerId,
    request.params.zone,
    {
      refresh: queryBool(q, 'refresh'),
    },
  )
  return reply.send(success(result))
}

export async function recordStore(
  request: FastifyRequest<{ Params: { providerId: string; zone: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.dnspodRecordService.create(
    request.params.providerId,
    request.params.zone,
    bodyRecord(request),
  )
  return reply.status(201).send(success(result))
}

export async function recordUpdate(
  request: FastifyRequest<{ Params: { providerId: string; zone: string; recordId: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.dnspodRecordService.update(
    request.params.providerId,
    request.params.zone,
    request.params.recordId,
    bodyRecord(request),
  )
  return reply.send(success(result))
}

export async function recordDelete(
  request: FastifyRequest<{ Params: { providerId: string; zone: string; recordId: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.dnspodRecordService.delete(
    request.params.providerId,
    request.params.zone,
    request.params.recordId,
  )
  return reply.send(success(result))
}
