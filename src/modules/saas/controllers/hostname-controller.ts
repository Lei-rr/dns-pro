import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import { bodyRecord, queryBool, queryRecord } from '../../../lib/utils/request-parse.js'
import { hostnameFqdnParam, zoneNameParam } from './request-params.js'

export async function zonesIndex(
  request: FastifyRequest<{ Params: { providerId: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const result = await request.server.ctx.saasHostnameService.zones(
    request.params.providerId,
    queryBool(q, 'refresh'),
  )
  return reply.send(success(result))
}

export async function hostnamesIndex(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const result = await request.server.ctx.saasWorkflowService.listHostnames(
    request.params.providerId,
    zoneNameParam(request),
    queryBool(q, 'refresh'),
  )
  return reply.send(success(result))
}

export async function hostnamesStore(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const body = bodyRecord(request)
  const result = await request.server.ctx.saasWorkflowService.createHostname(
    request.params.providerId,
    zoneNameParam(request),
    body,
    queryBool(q, 'auto_sync'),
  )
  return reply.status(201).send(success(result))
}

export async function hostnamesShow(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string; hostnameFqdn: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const result = await request.server.ctx.saasHostnameService.showHostname(
    request.params.providerId,
    zoneNameParam(request),
    hostnameFqdnParam(request),
    queryBool(q, 'refresh'),
  )
  return reply.send(success(result))
}

export async function hostnamesUpdate(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string; hostnameFqdn: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const body = bodyRecord(request)
  const result = await request.server.ctx.saasWorkflowService.updateHostname(
    request.params.providerId,
    zoneNameParam(request),
    hostnameFqdnParam(request),
    body,
    queryBool(q, 'auto_sync'),
  )
  return reply.send(success(result))
}

export async function hostnamesRefresh(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string; hostnameFqdn: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.saasWorkflowService.refreshHostname(
    request.params.providerId,
    zoneNameParam(request),
    hostnameFqdnParam(request),
  )
  return reply.send(success(result))
}

export async function hostnamesDelete(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string; hostnameFqdn: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const result = await request.server.ctx.saasWorkflowService.deleteHostname(
    request.params.providerId,
    zoneNameParam(request),
    hostnameFqdnParam(request),
    queryBool(q, 'auto_cleanup', true),
  )
  return reply.send(success(result))
}

export async function fallbackOriginShow(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const result = await request.server.ctx.saasHostnameService.fallbackOriginInfo(
    request.params.providerId,
    zoneNameParam(request),
    queryBool(q, 'refresh'),
  )
  return reply.send(success(result))
}

export async function fallbackOriginUpdate(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string } }>,
  reply: FastifyReply,
) {
  const body = bodyRecord(request)
  const result = await request.server.ctx.saasHostnameService.setFallbackOrigin(
    request.params.providerId,
    zoneNameParam(request),
    String(body.origin ?? ''),
  )
  return reply.send(success(result))
}

export async function fallbackOriginDelete(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.saasHostnameService.deleteFallbackOrigin(
    request.params.providerId,
    zoneNameParam(request),
  )
  return reply.send(success(result))
}
