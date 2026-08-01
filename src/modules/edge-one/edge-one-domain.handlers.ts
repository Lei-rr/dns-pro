import type { FastifyReply, FastifyRequest } from 'fastify'
import { success } from '../../shared/http/api-response.js'
import type { RequestOf } from '../../shared/http/request-schema.js'
import {
  edgeoneCertificateSchema,
  edgeoneDomainsIndexSchema,
  edgeoneDomainUpdateSchema,
  edgeoneStatusSchema,
} from './edge-one.schema.js'

function domainNameParam(request: { params: { domainName: string } }): string {
  return request.params.domainName.trim()
}

export async function listEdgeOneDomainsHandler(
  request: FastifyRequest<RequestOf<typeof edgeoneDomainsIndexSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.edgeOne.domains.accelerationDomains(
    request.params.providerId,
    request.params.zoneId,
    request.query.refresh === 'true'
  )
  return reply.send(success(result))
}

export async function updateEdgeOneDomainHandler(
  request: FastifyRequest<RequestOf<typeof edgeoneDomainUpdateSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.edgeOne.domains.updateAccelerationDomain(
    request.params.providerId,
    request.params.zoneId,
    domainNameParam(request),
    request.body
  )
  return reply.send(success(result))
}

export async function updateEdgeOneDomainStatusHandler(
  request: FastifyRequest<RequestOf<typeof edgeoneStatusSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.edgeOne.domains.updateAccelerationDomainStatus(
    request.params.providerId,
    request.params.zoneId,
    domainNameParam(request),
    request.body.status
  )
  return reply.send(success(result))
}

export async function updateEdgeOneCertificateHandler(
  request: FastifyRequest<RequestOf<typeof edgeoneCertificateSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.edgeOne.domains.updateCertificate(
    request.params.providerId,
    request.params.zoneId,
    domainNameParam(request),
    request.body
  )
  return reply.send(success(result))
}
