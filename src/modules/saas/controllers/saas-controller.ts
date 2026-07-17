import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import { bodyRecord, queryBool, queryInt, queryRecord, queryString } from '../../../lib/utils/request-parse.js'
import { auditService } from '../../../lib/utils/audit.js'

function zoneNameParam(request: FastifyRequest<{ Params: { zoneName: string } }>): string {
  return decodeURIComponent(request.params.zoneName).trim()
}

function hostnameFqdnParam(request: FastifyRequest<{ Params: { hostnameFqdn: string } }>): string {
  return decodeURIComponent(request.params.hostnameFqdn).trim()
}

export async function zonesIndex(
  request: FastifyRequest<{ Params: { providerId: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const result = await request.server.ctx.saasHostnameService.zones(
    request.params.providerId,
    queryInt(q, 'page', 1, 1),
    queryInt(q, 'per_page', 100, 1, 500),
    queryString(q, 'name'),
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
    queryInt(q, 'page', 1, 1),
    queryInt(q, 'per_page', 20, 1, 200),
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
  await auditService.write({
    ts: Date.now(),
    action: 'saas.hostname.create',
    provider_id: request.params.providerId,
    zone: zoneNameParam(request),
    hostname: String(body.hostname ?? result.hostname ?? ''),
    result: 'success',
  })
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
  await auditService.write({
    ts: Date.now(),
    action: 'saas.hostname.update',
    provider_id: request.params.providerId,
    zone: zoneNameParam(request),
    hostname: hostnameFqdnParam(request),
    target: String(body.preferred_domain ?? ''),
    result: 'success',
  })
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
  await auditService.write({
    ts: Date.now(),
    action: 'saas.hostname.delete',
    provider_id: request.params.providerId,
    zone: zoneNameParam(request),
    hostname: hostnameFqdnParam(request),
    result: 'success',
  })
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

export async function preferredApplyPreview(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string } }>,
  reply: FastifyReply,
) {
  const body = bodyRecord(request)
  const result = await request.server.ctx.saasPreferredApplyService.preview({
    providerId: request.params.providerId,
    zoneName: zoneNameParam(request),
    preferredDomain: String(body.preferred_domain ?? ''),
    hostnames: Array.isArray(body.hostnames) ? body.hostnames.map(String) : undefined,
    onlyAutoPreferred: Boolean(body.only_auto_preferred),
  })
  return reply.send(success(result))
}

export async function preferredApplyStore(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string } }>,
  reply: FastifyReply,
) {
  const body = bodyRecord(request)
  const result = await request.server.ctx.saasPreferredApplyService.create({
    providerId: request.params.providerId,
    zoneName: zoneNameParam(request),
    preferredDomain: String(body.preferred_domain ?? ''),
    hostnames: Array.isArray(body.hostnames) ? body.hostnames.map(String) : undefined,
    onlyAutoPreferred: Boolean(body.only_auto_preferred),
    dryRun: Boolean(body.dry_run),
  })
  await auditService.write({
    ts: Date.now(),
    action: 'saas.preferred_apply.create',
    provider_id: request.params.providerId,
    zone: zoneNameParam(request),
    target: String(body.preferred_domain ?? ''),
    result: 'success',
    meta: { job_id: result.id, dry_run: result.dry_run, total: result.total },
  })
  return reply.status(201).send(success(result))
}

export async function preferredApplyShow(
  request: FastifyRequest<{ Params: { jobId: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.saasPreferredApplyService.find(request.params.jobId)
  return reply.send(success(result))
}

export async function preferredApplyActive(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.saasPreferredApplyService.active(
    request.params.providerId,
    zoneNameParam(request),
  )
  return reply.send(success(result))
}

export async function preferredApplyRetry(
  request: FastifyRequest<{ Params: { jobId: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.saasPreferredApplyService.retryFailed(request.params.jobId)
  return reply.send(success(result))
}
