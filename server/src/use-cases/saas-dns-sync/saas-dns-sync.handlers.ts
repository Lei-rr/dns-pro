import type { FastifyReply, FastifyRequest } from 'fastify'
import { success } from '../../kernel/http/api-response.js'
import { trimmedParam } from '../../kernel/http/route-params.js'
import type { RequestOf } from '../../kernel/http/request-schema.js'
import {
  saasHostnameDeleteSchema,
  saasHostnameParamsSchema,
  saasHostnameStoreSchema,
  saasHostnameUpdateSchema,
} from '../../domains/cloudflare/saas/saas.schema.js'

export async function createSaaSHostnameHandler(
  request: FastifyRequest<RequestOf<typeof saasHostnameStoreSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.workflows.saasDnsSync.createHostname(
    request.params.providerId,
    trimmedParam(request, 'zoneName'),
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
    trimmedParam(request, 'zoneName'),
    trimmedParam(request, 'hostnameFqdn'),
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
    trimmedParam(request, 'zoneName'),
    trimmedParam(request, 'hostnameFqdn')
  )
  return reply.send(success(result))
}

export async function repairSaaSHostnameDnsHandler(
  request: FastifyRequest<RequestOf<typeof saasHostnameParamsSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.workflows.saasDnsSync.repairHostnameDns(
    request.params.providerId,
    trimmedParam(request, 'zoneName'),
    trimmedParam(request, 'hostnameFqdn')
  )
  return reply.send(success(result))
}

export async function deleteSaaSHostnameHandler(
  request: FastifyRequest<RequestOf<typeof saasHostnameDeleteSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.workflows.saasDnsSync.deleteHostname(
    request.params.providerId,
    trimmedParam(request, 'zoneName'),
    trimmedParam(request, 'hostnameFqdn'),
    request.query.auto_cleanup === undefined || request.query.auto_cleanup === 'true'
  )
  return reply.send(success(result))
}
