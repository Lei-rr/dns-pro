import type { FastifyReply, FastifyRequest } from 'fastify'
import { success } from '../../shared/http/api-response.js'
import type { RequestOf } from '../../shared/http/request-schema.js'
import { hostnameFqdnParam, zoneNameParam } from './saas-request-params.js'
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
    zoneNameParam(request),
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
    zoneNameParam(request),
    hostnameFqdnParam(request),
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
    zoneNameParam(request),
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
    zoneNameParam(request),
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
    zoneNameParam(request)
  )
  return reply.send(success(result))
}
