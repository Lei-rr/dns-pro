import type { FastifyRequest, FastifyReply } from 'fastify'
import { success, noContent } from '../../../lib/http/api-response.js'
import { parseBool } from '../../../lib/utils/parse-bool.js'


function zoneNameParam(request: FastifyRequest<{ Params: { zoneName: string } }>): string {
  return decodeURIComponent(request.params.zoneName).trim()
}

function hostnameFqdnParam(request: FastifyRequest<{ Params: { hostnameFqdn: string } }>): string {
  return decodeURIComponent(request.params.hostnameFqdn).trim()
}

export async function zonesIndex(
  request: FastifyRequest<{ Params: { providerId: string }; Querystring: any }>,
  reply: FastifyReply
) {
  const q: any = request.query ?? {}
  const result = await request.server.ctx.saasHostnameService.zones(
    request.params.providerId,
    q.page ?? 1,
    q.per_page ?? 100,
    q.name ?? '',
    parseBool(q.refresh)
  )
  return reply.send(success(result))
}

export async function hostnamesIndex(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string }; Querystring: any }>,
  reply: FastifyReply
) {
  const q: any = request.query ?? {}
  const result = await request.server.ctx.saasWorkflowService.listHostnames(
    request.params.providerId,
    zoneNameParam(request),
    q.page ?? 1,
    q.per_page ?? 20,
    parseBool(q.refresh)
  )
  return reply.send(success(result))
}

export async function hostnamesStore(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string }; Body: any; Querystring: any }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.saasWorkflowService.createHostname(
    request.params.providerId,
    zoneNameParam(request),
    ((request.body ?? {}) as any) as Record<string, unknown>,
    parseBool(((request.query ?? {}) as any).auto_sync)
  )
  return reply.status(201).send(success(result))
}

export async function hostnamesShow(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string; hostnameFqdn: string }; Querystring: any }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.saasHostnameService.showHostname(
    request.params.providerId,
    zoneNameParam(request),
    hostnameFqdnParam(request),
    parseBool(((request.query ?? {}) as any).refresh)
  )
  return reply.send(success(result))
}

export async function hostnamesUpdate(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string; hostnameFqdn: string }; Body: any; Querystring: any }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.saasWorkflowService.updateHostname(
    request.params.providerId,
    zoneNameParam(request),
    hostnameFqdnParam(request),
    ((request.body ?? {}) as any) as Record<string, unknown>,
    parseBool(((request.query ?? {}) as any).auto_sync)
  )
  return reply.send(success(result))
}

export async function hostnamesRefresh(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string; hostnameFqdn: string } }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.saasWorkflowService.refreshHostname(
    request.params.providerId,
    zoneNameParam(request),
    hostnameFqdnParam(request)
  )
  return reply.send(success(result))
}

export async function hostnamesDelete(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string; hostnameFqdn: string }; Querystring: any }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.saasWorkflowService.deleteHostname(
    request.params.providerId,
    zoneNameParam(request),
    hostnameFqdnParam(request),
    parseBool(((request.query ?? {}) as any).auto_cleanup ?? true)
  )
  return reply.send(success(result))
}

export async function fallbackOriginShow(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string }; Querystring: any }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.saasHostnameService.fallbackOriginInfo(
    request.params.providerId,
    zoneNameParam(request),
    parseBool(((request.query ?? {}) as any).refresh)
  )
  return reply.send(success(result))
}

export async function fallbackOriginUpdate(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string }; Body: any }>,
  reply: FastifyReply
) {
  const body: any = request.body ?? {}
  const result = await request.server.ctx.saasHostnameService.setFallbackOrigin(
    request.params.providerId,
    zoneNameParam(request),
    body.origin
  )
  return reply.send(success(result))
}

export async function fallbackOriginDelete(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string } }>,
  reply: FastifyReply
) {
  await request.server.ctx.saasHostnameService.deleteFallbackOrigin(
    request.params.providerId,
    zoneNameParam(request)
  )
  return reply.status(204).send(noContent())
}
