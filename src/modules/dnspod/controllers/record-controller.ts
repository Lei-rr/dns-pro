import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'

export async function recordIndex(
  request: FastifyRequest<{ Params: { providerId: string; zone: string }; Querystring: any }>,
  reply: FastifyReply
) {
  return reply.send(success(await request.server.ctx.dnspodRecordService.list(request.params.providerId, request.params.zone, (request.query ?? {}) as any)))
}

export async function recordStore(
  request: FastifyRequest<{ Params: { providerId: string; zone: string }; Body: any }>,
  reply: FastifyReply
) {
  return reply.status(201).send(success(await request.server.ctx.dnspodRecordService.create(request.params.providerId, request.params.zone, (request.body ?? {}) as any)))
}

export async function recordUpdate(
  request: FastifyRequest<{ Params: { providerId: string; zone: string; recordId: string }; Body: any }>,
  reply: FastifyReply
) {
  return reply.send(success(await request.server.ctx.dnspodRecordService.update(request.params.providerId, request.params.zone, request.params.recordId, (request.body ?? {}) as any)))
}

export async function recordDelete(
  request: FastifyRequest<{ Params: { providerId: string; zone: string; recordId: string } }>,
  reply: FastifyReply
) {
  return reply.send(success(await request.server.ctx.dnspodRecordService.delete(request.params.providerId, request.params.zone, request.params.recordId)))
}
