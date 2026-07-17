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
  const result = await request.server.ctx.saasHostnameMutationUseCase.create(
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
  const result = await request.server.ctx.saasHostnameMutationUseCase.update(
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
  const result = await request.server.ctx.saasHostnameMutationUseCase.refresh(
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
  const result = await request.server.ctx.saasHostnameMutationUseCase.delete(
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

export async function batchDeleteStore(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string } }>,
  reply: FastifyReply,
) {
  const body = bodyRecord(request)
  const hostnames = Array.isArray(body.hostnames)
    ? body.hostnames.map(String)
    : Array.isArray(body.items)
      ? body.items.map((item) => String((item as any)?.hostname ?? item))
      : []
  const result = await request.server.ctx.saasBatchJobService.createDelete({
    providerId: request.params.providerId,
    zoneName: zoneNameParam(request),
    hostnames,
    autoCleanup: body.auto_cleanup === undefined ? true : Boolean(body.auto_cleanup),
  })
  return reply.status(201).send(success(result))
}

export async function batchUpdateStore(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string } }>,
  reply: FastifyReply,
) {
  const body = bodyRecord(request)
  const hostnames = Array.isArray(body.hostnames)
    ? body.hostnames.map(String)
    : Array.isArray(body.items)
      ? body.items.map((item) => String((item as any)?.hostname ?? item))
      : []
  const patchSource =
    body.patch && typeof body.patch === 'object' && !Array.isArray(body.patch)
      ? (body.patch as Record<string, unknown>)
      : body
  const allowed: Record<string, unknown> = {}
  for (const key of ['preferred_domain', 'auto_preferred', 'custom_origin_server', 'method', 'min_tls_version']) {
    if (key in patchSource) allowed[key] = patchSource[key]
  }
  const result = await request.server.ctx.saasBatchJobService.createUpdate({
    providerId: request.params.providerId,
    zoneName: zoneNameParam(request),
    hostnames,
    patch: allowed,
    autoSync: body.auto_sync === undefined ? true : Boolean(body.auto_sync),
  })
  return reply.status(201).send(success(result))
}

export async function batchJobShow(
  request: FastifyRequest<{ Params: { jobId: string } }>,
  reply: FastifyReply,
) {
  const result =
    (await request.server.ctx.saasBatchJobService.find(request.params.jobId)) ||
    (await request.server.ctx.saasPreferredApplyService.find(request.params.jobId))
  return reply.send(success(result))
}

export async function batchJobActive(
  request: FastifyRequest<{ Params: { providerId: string; zoneName: string } }>,
  reply: FastifyReply,
) {
  const result =
    (await request.server.ctx.saasBatchJobService.active(request.params.providerId, zoneNameParam(request))) ||
    (await request.server.ctx.saasPreferredApplyService.active(request.params.providerId, zoneNameParam(request)))
  return reply.send(success(result))
}

export async function batchJobRetry(
  request: FastifyRequest<{ Params: { jobId: string } }>,
  reply: FastifyReply,
) {
  const existing = await request.server.ctx.saasBatchJobService.find(request.params.jobId)
  const result = existing
    ? await request.server.ctx.saasBatchJobService.retryFailed(request.params.jobId)
    : await request.server.ctx.saasPreferredApplyService.retryFailed(request.params.jobId)
  return reply.send(success(result))
}
