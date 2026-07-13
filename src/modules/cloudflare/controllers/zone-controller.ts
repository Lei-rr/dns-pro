import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'

export async function zoneIndex(
  request: FastifyRequest<{ Params: { providerId: string }; Querystring: any }>,
  reply: FastifyReply
) {
  const q: any = request.query ?? {}
  const result = await request.server.ctx.cloudflareZoneService.list(
    request.params.providerId,
    Number(q.page ?? 1),
    Number(q.per_page ?? 20),
    String(q.name ?? ''),
    Boolean(q.refresh === true || q.refresh === '1' || q.refresh === 'true')
  )
  return reply.send(success(result))
}

export async function zoneStore(
  request: FastifyRequest<{ Params: { providerId: string }; Body: any }>,
  reply: FastifyReply
) {
  const body: any = request.body ?? {}
  const result = await request.server.ctx.cloudflareZoneService.create(
    request.params.providerId,
    String(body.name ?? ''),
    String(body.type ?? 'full')
  )
  return reply.status(201).send(success(result))
}

export async function zoneDelete(
  request: FastifyRequest<{ Params: { providerId: string; zone: string } }>,
  reply: FastifyReply
) {
  const zoneId = await request.server.ctx.cloudflareZoneService.idByName(request.params.providerId, request.params.zone)
  const result = await request.server.ctx.cloudflareZoneService.delete(request.params.providerId, zoneId)
  return reply.send(success(result))
}
