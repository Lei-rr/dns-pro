import type { FastifyReply, FastifyRequest } from 'fastify'
import { success } from '../../shared/http/api-response.js'
import type { RequestOf } from '../../shared/http/request-schema.js'
import { hostnameFqdnParam, zoneNameParam } from '../../modules/saas/saas-request-params.js'
import {
  saasHostnameDeleteSchema,
  saasHostnameParamsSchema,
  saasHostnameStoreSchema,
  saasHostnameUpdateSchema,
} from '../../modules/saas/saas.schema.js'

export async function createSaaSHostnameHandler(
  request: FastifyRequest<RequestOf<typeof saasHostnameStoreSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.workflows.saasDnsSync.createHostname(
    request.params.providerId,
    zoneNameParam(request),
    request.body,
    request.query.auto_sync === 'true'
  )
  return reply.status(201).send(success(result))
}

export async function updateSaaSHostnameHandler(
  request: FastifyRequest<RequestOf<typeof saasHostnameUpdateSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.workflows.saasDnsSync.updateHostname(
    request.params.providerId,
    zoneNameParam(request),
    hostnameFqdnParam(request),
    request.body,
    request.query.auto_sync === 'true'
  )
  return reply.send(success(result))
}

export async function reconcileSaaSHostnameHandler(
  request: FastifyRequest<RequestOf<typeof saasHostnameParamsSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.workflows.saasDnsSync.reconcileHostname(
    request.params.providerId,
    zoneNameParam(request),
    hostnameFqdnParam(request)
  )
  return reply.send(success(result))
}

export async function deleteSaaSHostnameHandler(
  request: FastifyRequest<RequestOf<typeof saasHostnameDeleteSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.workflows.saasDnsSync.deleteHostname(
    request.params.providerId,
    zoneNameParam(request),
    hostnameFqdnParam(request),
    request.query.auto_cleanup === undefined || request.query.auto_cleanup === 'true'
  )
  return reply.send(success(result))
}
