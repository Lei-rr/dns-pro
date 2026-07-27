import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import { bodyRecord, bodyString, queryBool, queryInt, queryRecord } from '../../../lib/utils/request-parse.js'

function domainNameParam(request: { params: { domainName: string } }): string {
  return decodeURIComponent(request.params.domainName).trim()
}

export async function domainsIndex(
  request: FastifyRequest<{ Params: { providerId: string; zoneId: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const result = await request.server.ctx.edgeoneDomainService.accelerationDomains(
    request.params.providerId,
    request.params.zoneId,
    queryInt(q, 'offset', 0),
    queryInt(q, 'limit', 20, 1, 200),
    queryBool(q, 'refresh'),
  )
  return reply.send(success(result))
}

export async function domainStore(
  request: FastifyRequest<{ Params: { providerId: string; zoneId: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const result = await request.server.ctx.edgeoneWorkflowService.createAccelerationDomain(
    request.params.providerId,
    request.params.zoneId,
    bodyRecord(request),
    queryBool(q, 'auto_sync'),
  )
  return reply.status(201).send(success(result))
}

export async function domainUpdate(
  request: FastifyRequest<{ Params: { providerId: string; zoneId: string; domainName: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.edgeoneDomainService.updateAccelerationDomain(
    request.params.providerId,
    request.params.zoneId,
    domainNameParam(request),
    bodyRecord(request),
  )
  return reply.send(success(result))
}

export async function domainDelete(
  request: FastifyRequest<{ Params: { providerId: string; zoneId: string; domainName: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const result = await request.server.ctx.edgeoneWorkflowService.deleteAccelerationDomain(
    request.params.providerId,
    request.params.zoneId,
    domainNameParam(request),
    queryBool(q, 'auto_cleanup', true),
  )
  return reply.send(success(result))
}

export async function domainStatusUpdate(
  request: FastifyRequest<{ Params: { providerId: string; zoneId: string; domainName: string } }>,
  reply: FastifyReply,
) {
  const body = bodyRecord(request)
  const result = await request.server.ctx.edgeoneDomainService.updateAccelerationDomainStatus(
    request.params.providerId,
    request.params.zoneId,
    domainNameParam(request),
    bodyString(body, 'status'),
  )
  return reply.send(success(result))
}

export async function domainCertificateUpdate(
  request: FastifyRequest<{ Params: { providerId: string; zoneId: string; domainName: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.edgeoneDomainService.updateCertificate(
    request.params.providerId,
    request.params.zoneId,
    domainNameParam(request),
    bodyRecord(request),
  )
  return reply.send(success(result))
}

export async function domainCnameSync(
  request: FastifyRequest<{ Params: { providerId: string; zoneId: string; domainName: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.edgeoneWorkflowService.syncCname(
    request.params.providerId,
    request.params.zoneId,
    domainNameParam(request),
  )
  return reply.send(success(result))
}
