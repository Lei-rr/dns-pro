import type { FastifyReply, FastifyRequest } from 'fastify'
import { success } from '../../../core/http/api-response.js'
import { trimmedParam } from '../../../core/http/route-params.js'
import type { RequestOf } from '../../../core/http/request-schema.js'
import {
  saasFallbackShowSchema,
  saasFallbackWriteSchema,
  saasHostnameShowSchema,
  saasHostnamesIndexSchema,
  saasZoneParamsSchema,
  saasZonesIndexSchema,
} from './saas.schema.js'

export async function listSaaSZonesHandler(
  request: FastifyRequest<RequestOf<typeof saasZonesIndexSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.saas.hostnames.zones(
    request.params.providerId,
    request.query.refresh === 'true'
  )
  return reply.send(success(result))
}

export async function listSaaSHostnamesHandler(
  request: FastifyRequest<RequestOf<typeof saasHostnamesIndexSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.saas.hostnames.hostnames(
    request.params.providerId,
    trimmedParam(request, 'zoneName'),
    request.query.refresh === 'true'
  )
  return reply.send(success(result))
}

export async function getSaaSHostnameHandler(
  request: FastifyRequest<RequestOf<typeof saasHostnameShowSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.saas.hostnames.showHostname(
    request.params.providerId,
    trimmedParam(request, 'zoneName'),
    trimmedParam(request, 'hostnameFqdn'),
    request.query.refresh === 'true'
  )
  return reply.send(success(result))
}

export async function getFallbackOriginHandler(
  request: FastifyRequest<RequestOf<typeof saasFallbackShowSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.saas.hostnames.fallbackOriginInfo(
    request.params.providerId,
    trimmedParam(request, 'zoneName'),
    request.query.refresh === 'true'
  )
  return reply.send(success(result))
}

export async function updateFallbackOriginHandler(
  request: FastifyRequest<RequestOf<typeof saasFallbackWriteSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.saas.hostnames.setFallbackOrigin(
    request.params.providerId,
    trimmedParam(request, 'zoneName'),
    request.body.origin
  )
  return reply.send(success(result))
}

export async function deleteFallbackOriginHandler(
  request: FastifyRequest<RequestOf<typeof saasZoneParamsSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.saas.hostnames.deleteFallbackOrigin(
    request.params.providerId,
    trimmedParam(request, 'zoneName')
  )
  return reply.send(success(result))
}
