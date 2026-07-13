import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import { parseBool } from '../../../lib/utils/parse-bool.js'


export async function edgeOneAccelerationDomainsIndex(
  request: FastifyRequest<{ Params: { providerId: string; zoneId: string }; Querystring: any }>,
  reply: FastifyReply
) {
  const q: any = request.query ?? {}
  const result = await request.server.ctx.edgeoneDomainService.accelerationDomains(
    request.params.providerId,
    request.params.zoneId,
    q.offset ?? 0,
    q.limit ?? 20,
    parseBool(q.refresh)
  )
  return reply.send(success(result))
}

export async function edgeOneAccelerationDomainStore(
  request: FastifyRequest<{ Params: { providerId: string; zoneId: string }; Body: any; Querystring: any }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.edgeoneWorkflowService.createAccelerationDomain(
    request.params.providerId,
    request.params.zoneId,
    ((request.body ?? {}) as any) as Record<string, unknown>,
    parseBool(((request.query ?? {}) as any).auto_sync)
  )
  return reply.status(201).send(success(result))
}

export async function edgeOneAccelerationDomainUpdate(
  request: FastifyRequest<{ Params: { providerId: string; zoneId: string; domainName: string }; Body: any }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.edgeoneDomainService.updateAccelerationDomain(
    request.params.providerId,
    request.params.zoneId,
    decodeURIComponent(request.params.domainName).trim(),
    ((request.body ?? {}) as any) as Record<string, unknown>
  )
  return reply.send(success(result))
}

export async function edgeOneAccelerationDomainDelete(
  request: FastifyRequest<{ Params: { providerId: string; zoneId: string; domainName: string }; Querystring: any }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.edgeoneWorkflowService.deleteAccelerationDomain(
    request.params.providerId,
    request.params.zoneId,
    decodeURIComponent(request.params.domainName).trim(),
    parseBool(((request.query ?? {}) as any).auto_cleanup ?? true)
  )
  return reply.send(success(result))
}

export async function edgeOneAccelerationDomainStatusUpdate(
  request: FastifyRequest<{ Params: { providerId: string; zoneId: string; domainName: string }; Body: any }>,
  reply: FastifyReply
) {
  const body: any = request.body ?? {}
  const result = await request.server.ctx.edgeoneDomainService.updateAccelerationDomainStatus(
    request.params.providerId,
    request.params.zoneId,
    decodeURIComponent(request.params.domainName).trim(),
    body.status
  )
  return reply.send(success(result))
}

export async function edgeOneAccelerationDomainCertificateUpdate(
  request: FastifyRequest<{ Params: { providerId: string; zoneId: string; domainName: string }; Body: any }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.edgeoneDomainService.updateCertificate(
    request.params.providerId,
    request.params.zoneId,
    decodeURIComponent(request.params.domainName).trim(),
    ((request.body ?? {}) as any) as Record<string, unknown>
  )
  return reply.send(success(result))
}

export async function edgeOneAccelerationDomainCnameSync(
  request: FastifyRequest<{ Params: { providerId: string; zoneId: string; domainName: string } }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.edgeoneWorkflowService.syncCname(
    request.params.providerId,
    request.params.zoneId,
    decodeURIComponent(request.params.domainName).trim()
  )
  return reply.send(success(result))
}
