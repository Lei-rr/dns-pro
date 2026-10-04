import type { FastifyReply, FastifyRequest } from 'fastify'
import { success } from '../../kernel/http/api-response.js'
import { trimmedParam } from '../../kernel/http/route-params.js'
import type { RequestOf } from '../../kernel/http/request-schema.js'
import { auditActor } from '../../kernel/observability/audit-log.js'
import {
  edgeoneBatchDeleteSchema,
  edgeoneBatchDisableSchema,
  edgeoneDomainDeleteSchema,
  edgeoneDomainParamsSchema,
  edgeoneDomainStoreSchema,
  edgeoneJobParamsSchema,
  edgeoneZoneParamsSchema,
} from '../../domains/edgeone/edge-one.schema.js'

export async function createEdgeOneDomainHandler(
  request: FastifyRequest<RequestOf<typeof edgeoneDomainStoreSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.workflows.edgeOneDnsSync.createAccelerationDomain(
    request.params.providerId,
    request.params.zoneId,
    request.body,
    request.query.auto_sync === 'true'
  )
  return reply.status(201).send(success(result))
}

export async function deleteEdgeOneDomainHandler(
  request: FastifyRequest<RequestOf<typeof edgeoneDomainDeleteSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.workflows.edgeOneDnsSync.deleteAccelerationDomain(
    request.params.providerId,
    request.params.zoneId,
    trimmedParam(request, 'domainName'),
    request.query.auto_cleanup === undefined || request.query.auto_cleanup === 'true'
  )
  return reply.send(success(result))
}

export async function repairEdgeOneDomainDnsHandler(
  request: FastifyRequest<RequestOf<typeof edgeoneDomainParamsSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.workflows.edgeOneDnsSync.repairDomainDns(
    request.params.providerId,
    request.params.zoneId,
    trimmedParam(request, 'domainName')
  )
  return reply.send(success(result))
}

export async function createEdgeOneBatchDisableHandler(
  request: FastifyRequest<RequestOf<typeof edgeoneBatchDisableSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.workflows.edgeOneBatch.createDisable({
    providerId: request.params.providerId,
    zoneId: request.params.zoneId,
    domains: request.body.domains,
  })
  request.server.ctx.platform.audit.record({
    action: 'batch',
    actor: await auditActor(request),
    target: `edgeone:${request.params.providerId}/${request.params.zoneId}`,
    detail: { operation: 'disable', job_id: result.id, domains: request.body.domains.length },
  })
  return reply.status(201).send(success(result))
}

export async function createEdgeOneBatchDeleteHandler(
  request: FastifyRequest<RequestOf<typeof edgeoneBatchDeleteSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.workflows.edgeOneBatch.createDelete({
    providerId: request.params.providerId,
    zoneId: request.params.zoneId,
    domains: request.body.domains,
    autoCleanup: request.body.auto_cleanup ?? true,
  })
  request.server.ctx.platform.audit.record({
    action: 'batch',
    actor: await auditActor(request),
    target: `edgeone:${request.params.providerId}/${request.params.zoneId}`,
    detail: { operation: 'delete', job_id: result.id, domains: request.body.domains.length },
  })
  return reply.status(201).send(success(result))
}

export async function getEdgeOneBatchJobHandler(
  request: FastifyRequest<RequestOf<typeof edgeoneJobParamsSchema>>,
  reply: FastifyReply
) {
  return reply.send(
    success(await request.server.ctx.workflows.edgeOneBatch.find(request.params.jobId, request.params.providerId))
  )
}

export async function getActiveEdgeOneBatchJobHandler(
  request: FastifyRequest<RequestOf<typeof edgeoneZoneParamsSchema>>,
  reply: FastifyReply
) {
  return reply.send(
    success(await request.server.ctx.workflows.edgeOneBatch.active(request.params.providerId, request.params.zoneId))
  )
}

export async function retryEdgeOneBatchJobHandler(
  request: FastifyRequest<RequestOf<typeof edgeoneJobParamsSchema>>,
  reply: FastifyReply
) {
  return reply.send(
    success(
      await request.server.ctx.workflows.edgeOneBatch.retryFailed(request.params.jobId, request.params.providerId)
    )
  )
}
