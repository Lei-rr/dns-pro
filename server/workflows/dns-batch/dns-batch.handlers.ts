import type { FastifyReply, FastifyRequest } from 'fastify'
import { success } from '../../core/http/api-response.js'
import type { RequestOf } from '../../core/http/request-schema.js'
import { auditActor } from '../../core/observability/audit-log.js'
import type { DnsProviderType } from './dns-batch.workflow.js'
import {
  dnsBatchCreateSchema,
  dnsBatchDeleteSchema,
  dnsBatchUpdateSchema,
  dnsJobParamsSchema,
  dnsZoneParamsSchema,
} from './dns-batch.schema.js'

/** 三个批量入队入口共用同一审计形状：目标定位到服务商 + 站点，detail 记录操作与条目数 */
function recordBatchAudit(
  request: FastifyRequest<RequestOf<typeof dnsZoneParamsSchema>>,
  input: { providerType: DnsProviderType; operation: string; jobId: string; count: number }
): void {
  request.server.ctx.platform.audit.record({
    action: 'batch',
    actor: auditActor(request),
    target: `${input.providerType}:${request.params.providerId}/${request.params.zone}`,
    detail: { operation: input.operation, job_id: input.jobId, records: input.count },
  })
}

export function createDnsBatchHandler(providerType: DnsProviderType) {
  return async function createDnsBatch(
    request: FastifyRequest<RequestOf<typeof dnsBatchCreateSchema>>,
    reply: FastifyReply
  ) {
    const result = await request.server.ctx.workflows.dnsBatch.createCreate({
      providerType,
      providerId: request.params.providerId,
      zone: request.params.zone,
      records: request.body.records,
    })
    recordBatchAudit(request, {
      providerType,
      operation: 'create',
      jobId: result.id,
      count: request.body.records.length,
    })
    return reply.status(201).send(success(result))
  }
}

export function deleteDnsBatchHandler(providerType: DnsProviderType) {
  return async function deleteDnsBatch(
    request: FastifyRequest<RequestOf<typeof dnsBatchDeleteSchema>>,
    reply: FastifyReply
  ) {
    const result = await request.server.ctx.workflows.dnsBatch.createDelete({
      providerType,
      providerId: request.params.providerId,
      zone: request.params.zone,
      records: request.body.records,
    })
    recordBatchAudit(request, {
      providerType,
      operation: 'delete',
      jobId: result.id,
      count: request.body.records.length,
    })
    return reply.status(201).send(success(result))
  }
}

export function updateDnsBatchHandler(providerType: DnsProviderType) {
  return async function updateDnsBatch(
    request: FastifyRequest<RequestOf<typeof dnsBatchUpdateSchema>>,
    reply: FastifyReply
  ) {
    const result = await request.server.ctx.workflows.dnsBatch.createUpdate({
      providerType,
      providerId: request.params.providerId,
      zone: request.params.zone,
      records: request.body.records,
      patch: request.body.patch,
    })
    recordBatchAudit(request, {
      providerType,
      operation: 'update',
      jobId: result.id,
      count: request.body.records.length,
    })
    return reply.status(201).send(success(result))
  }
}

export function getDnsBatchHandler(providerType: DnsProviderType) {
  return async function getDnsBatch(
    request: FastifyRequest<RequestOf<typeof dnsJobParamsSchema>>,
    reply: FastifyReply
  ) {
    return reply.send(
      success(
        await request.server.ctx.workflows.dnsBatch.find(request.params.jobId, providerType, request.params.providerId)
      )
    )
  }
}

export function getActiveDnsBatchHandler(providerType: DnsProviderType) {
  return async function getActiveDnsBatch(
    request: FastifyRequest<RequestOf<typeof dnsZoneParamsSchema>>,
    reply: FastifyReply
  ) {
    return reply.send(
      success(
        await request.server.ctx.workflows.dnsBatch.active(providerType, request.params.providerId, request.params.zone)
      )
    )
  }
}

export function retryDnsBatchHandler(providerType: DnsProviderType) {
  return async function retryDnsBatch(
    request: FastifyRequest<RequestOf<typeof dnsJobParamsSchema>>,
    reply: FastifyReply
  ) {
    return reply.send(
      success(
        await request.server.ctx.workflows.dnsBatch.retryFailed(
          request.params.jobId,
          providerType,
          request.params.providerId
        )
      )
    )
  }
}
