import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'

export async function zoneIndex(
  request: FastifyRequest<{ Params: { providerId: string }; Querystring: any }>,
  reply: FastifyReply
) {
  return reply.send(success(await request.server.ctx.dnspodZoneService.list(request.params.providerId, (request.query ?? {}) as any)))
}

export async function zoneStore(
  request: FastifyRequest<{ Params: { providerId: string }; Body: any }>,
  reply: FastifyReply
) {
  const body: any = request.body ?? {}
  return reply.status(201).send(success(await request.server.ctx.dnspodZoneService.create(request.params.providerId, String(body.domain ?? body.name ?? ''))))
}

export async function zoneDelete(
  request: FastifyRequest<{ Params: { providerId: string; zone: string } }>,
  reply: FastifyReply
) {
  return reply.send(success(await request.server.ctx.dnspodZoneService.delete(request.params.providerId, request.params.zone)))
}
