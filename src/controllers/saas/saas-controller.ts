import type { FastifyRequest, FastifyReply } from 'fastify'
import { SaasHostnameService } from '../../services/saas/saas-hostname-service.js'
import { SaasWorkflowService } from '../../services/saas/saas-workflow-service.js'
import { success, noContent } from '../../support/api-response.js'
import type { SaasListZonesInput, SaasListHostnamesInput, SaasShowInput, SaasStoreInput, SaasUpdateInput, SaasFallbackOriginInput } from '../../schemas/saas.js'

const hostnameService = new SaasHostnameService()
const workflowService = new SaasWorkflowService()

function parseBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true'
  return false
}

function zoneNameParam(request: FastifyRequest<{ Params: { zoneName: string } }>): string {
  return decodeURIComponent(request.params.zoneName).trim()
}

function hostnameFqdnParam(request: FastifyRequest<{ Params: { hostnameFqdn: string } }>): string {
  return decodeURIComponent(request.params.hostnameFqdn).trim()
}

export async function zonesIndex(request: FastifyRequest<{ Params: { providerId: string }; Querystring: SaasListZonesInput }>, reply: FastifyReply) {
  const result = await hostnameService.zones(
    request.params.providerId,
    request.query.page ?? 1,
    request.query.per_page ?? 100,
    request.query.name ?? '',
    parseBool(request.query.refresh)
  )
  return reply.send(success(result))
}

export async function hostnamesIndex(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string }; Querystring: SaasListHostnamesInput }>,
  reply: FastifyReply
) {
  const result = await workflowService.listHostnames(
    request.params.providerId,
    zoneNameParam(request),
    request.query.page ?? 1,
    request.query.per_page ?? 20,
    parseBool(request.query.refresh)
  )
  return reply.send(success(result))
}

export async function hostnamesStore(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string }; Body: SaasStoreInput; Querystring: Record<string, unknown> }>,
  reply: FastifyReply
) {
  const result = await workflowService.createHostname(
    request.params.providerId,
    zoneNameParam(request),
    request.body as Record<string, unknown>,
    parseBool(request.query.auto_sync)
  )
  return reply.status(201).send(success(result))
}

export async function hostnamesShow(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string; hostnameFqdn: string }; Querystring: SaasShowInput }>,
  reply: FastifyReply
) {
  const result = await hostnameService.showHostname(
    request.params.providerId,
    zoneNameParam(request),
    hostnameFqdnParam(request),
    parseBool(request.query.refresh)
  )
  return reply.send(success(result))
}

export async function hostnamesUpdate(
  request: FastifyRequest<{
    Params: { providerId: string; zoneName: string; hostnameFqdn: string }
    Body: SaasUpdateInput
    Querystring: Record<string, unknown>
  }>,
  reply: FastifyReply
) {
  const result = await workflowService.updateHostname(
    request.params.providerId,
    zoneNameParam(request),
    hostnameFqdnParam(request),
    request.body as Record<string, unknown>,
    parseBool(request.query.auto_sync)
  )
  return reply.send(success(result))
}

export async function hostnamesRefresh(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string; hostnameFqdn: string } }>,
  reply: FastifyReply
) {
  const result = await workflowService.refreshHostname(request.params.providerId, zoneNameParam(request), hostnameFqdnParam(request))
  return reply.send(success(result))
}

export async function hostnamesDelete(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string; hostnameFqdn: string }; Querystring: Record<string, unknown> }>,
  reply: FastifyReply
) {
  const result = await workflowService.deleteHostname(
    request.params.providerId,
    zoneNameParam(request),
    hostnameFqdnParam(request),
    parseBool(request.query.auto_cleanup ?? true)
  )
  return reply.send(success(result))
}

export async function fallbackOriginShow(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string }; Querystring: SaasShowInput }>,
  reply: FastifyReply
) {
  const result = await hostnameService.fallbackOriginInfo(request.params.providerId, zoneNameParam(request), parseBool(request.query.refresh))
  return reply.send(success(result))
}

export async function fallbackOriginUpdate(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string }; Body: SaasFallbackOriginInput }>,
  reply: FastifyReply
) {
  const result = await hostnameService.setFallbackOrigin(request.params.providerId, zoneNameParam(request), request.body.origin)
  return reply.send(success(result))
}

export async function fallbackOriginDelete(request: FastifyRequest<{ Params: { providerId: string; zoneName: string } }>, reply: FastifyReply) {
  await hostnameService.deleteFallbackOrigin(request.params.providerId, zoneNameParam(request))
  return reply.status(204).send(noContent())
}
