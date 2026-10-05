import type { FastifyReply, FastifyRequest } from 'fastify'
import { success } from '../../core/http/api-response.js'
import type { RequestOf } from '../../core/http/request-schema.js'
import { auditActor } from '../../core/observability/audit-log.js'
import {
  saasJobParamsSchema,
  saasPreferredApplySchema,
  saasZoneParamsSchema,
} from '../../modules/cloudflare/saas/saas.schema.js'

export async function previewPreferredApplyHandler(
  request: FastifyRequest<RequestOf<typeof saasPreferredApplySchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.workflows.saasPreferredApply.preview({
    providerId: request.params.providerId,
    zoneName: request.params.zoneName,
    preferredDomain: request.body.preferred_domain,
    hostnames: request.body.hostnames,
    onlyAutoPreferred: request.body.only_auto_preferred ?? false,
  })
  return reply.send(success(result))
}

export async function createPreferredApplyHandler(
  request: FastifyRequest<RequestOf<typeof saasPreferredApplySchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.workflows.saasPreferredApply.create({
    providerId: request.params.providerId,
    zoneName: request.params.zoneName,
    preferredDomain: request.body.preferred_domain,
    hostnames: request.body.hostnames,
    onlyAutoPreferred: request.body.only_auto_preferred ?? false,
  })
  request.server.ctx.platform.audit.record({
    action: 'batch',
    actor: auditActor(request),
    target: `saas-preferred:${request.params.providerId}/${request.params.zoneName}`,
    detail: {
      operation: 'preferred_apply',
      job_id: result.id,
      preferred_domain: request.body.preferred_domain,
    },
  })
  return reply.status(201).send(success(result))
}

export async function getPreferredApplyJobHandler(
  request: FastifyRequest<RequestOf<typeof saasJobParamsSchema>>,
  reply: FastifyReply
) {
  // 归属校验：providerId 取自路径，跨服务商查询与任务不存在共用同一 not_found 口径
  return reply.send(
    success(
      await request.server.ctx.workflows.saasPreferredApply.require(request.params.jobId, request.params.providerId)
    )
  )
}

export async function getActivePreferredApplyJobHandler(
  request: FastifyRequest<RequestOf<typeof saasZoneParamsSchema>>,
  reply: FastifyReply
) {
  return reply.send(
    success(
      await request.server.ctx.workflows.saasPreferredApply.active(request.params.providerId, request.params.zoneName)
    )
  )
}

export async function retryPreferredApplyJobHandler(
  request: FastifyRequest<RequestOf<typeof saasJobParamsSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.workflows.saasPreferredApply.retryFailed(
    request.params.jobId,
    request.params.providerId
  )
  return reply.send(success(result))
}
