import type { FastifyReply, FastifyRequest } from 'fastify'
import { success } from '../../shared/http/api-response.js'
import type { RequestOf } from '../../shared/http/request-schema.js'
import { zoneNameParam } from '../../modules/saas/saas-request-params.js'
import { saasJobParamsSchema, saasPreferredApplySchema, saasZoneParamsSchema } from '../../modules/saas/saas.schema.js'

export async function previewPreferredApplyHandler(
  request: FastifyRequest<RequestOf<typeof saasPreferredApplySchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.workflows.saasPreferredApply.preview({
    providerId: request.params.providerId,
    zoneName: zoneNameParam(request),
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
    zoneName: zoneNameParam(request),
    preferredDomain: request.body.preferred_domain,
    hostnames: request.body.hostnames,
    onlyAutoPreferred: request.body.only_auto_preferred ?? false,
    dryRun: request.body.dry_run ?? false,
  })
  return reply.status(201).send(success(result))
}

export async function getPreferredApplyJobHandler(
  request: FastifyRequest<RequestOf<typeof saasJobParamsSchema>>,
  reply: FastifyReply
) {
  return reply.send(success(await request.server.ctx.workflows.saasPreferredApply.find(request.params.jobId)))
}

export async function getActivePreferredApplyJobHandler(
  request: FastifyRequest<RequestOf<typeof saasZoneParamsSchema>>,
  reply: FastifyReply
) {
  return reply.send(
    success(
      await request.server.ctx.workflows.saasPreferredApply.active(request.params.providerId, zoneNameParam(request))
    )
  )
}

export async function retryPreferredApplyJobHandler(
  request: FastifyRequest<RequestOf<typeof saasJobParamsSchema>>,
  reply: FastifyReply
) {
  return reply.send(success(await request.server.ctx.workflows.saasPreferredApply.retryFailed(request.params.jobId)))
}
