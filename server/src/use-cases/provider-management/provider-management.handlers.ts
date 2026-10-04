import type { FastifyReply, FastifyRequest } from 'fastify'
import { noContent, success } from '../../kernel/http/api-response.js'
import { ApiError } from '../../kernel/http/api-error.js'
import { noRequestSchema, type RequestOf } from '../../kernel/http/request-schema.js'
import { auditActor } from '../../kernel/observability/audit-log.js'
import {
  providerIdParamsSchema,
  providerSortSchema,
  providerStoreSchema,
  providerUpdateSchema,
} from './provider-management.schema.js'

export async function listProviderDefinitionsHandler(
  request: FastifyRequest<RequestOf<typeof noRequestSchema>>,
  reply: FastifyReply
) {
  return reply.send(success(request.server.ctx.workflows.providerManagement.definitions()))
}

export async function listProvidersHandler(
  request: FastifyRequest<RequestOf<typeof noRequestSchema>>,
  reply: FastifyReply
) {
  return reply.send(success(await request.server.ctx.workflows.providerManagement.list()))
}

export async function getProviderHandler(
  request: FastifyRequest<RequestOf<typeof providerIdParamsSchema>>,
  reply: FastifyReply
) {
  const provider = await request.server.ctx.workflows.providerManagement.get(request.params.id)
  if (!provider) throw new ApiError('provider_not_found', 'Provider not found', 404)
  return reply.send(success(provider))
}

export async function createProviderHandler(
  request: FastifyRequest<RequestOf<typeof providerStoreSchema>>,
  reply: FastifyReply
) {
  const provider = await request.server.ctx.workflows.providerManagement.create(request.body)
  request.log.info({ provider_id: provider.id, provider_type: provider.type }, 'provider.created')
  request.server.ctx.platform.audit.record({
    action: 'credential_change',
    actor: await auditActor(request),
    target: provider.id,
    detail: { operation: 'create', provider_type: provider.type },
  })
  return reply.status(201).send(success(provider))
}

export async function updateProviderHandler(
  request: FastifyRequest<RequestOf<typeof providerUpdateSchema>>,
  reply: FastifyReply
) {
  const provider = await request.server.ctx.workflows.providerManagement.update(request.params.id, request.body)
  request.log.info({ provider_id: provider.id, provider_type: provider.type }, 'provider.updated')
  request.server.ctx.platform.audit.record({
    action: 'credential_change',
    actor: await auditActor(request),
    target: provider.id,
    detail: { operation: 'update', provider_type: provider.type },
  })
  return reply.send(success(provider))
}

export async function deleteProviderHandler(
  request: FastifyRequest<RequestOf<typeof providerIdParamsSchema>>,
  reply: FastifyReply
) {
  const providerId = request.params.id
  const actor = await auditActor(request)
  await request.server.ctx.workflows.providerManagement.delete(providerId)
  request.log.info({ provider_id: providerId }, 'provider.deleted')
  request.server.ctx.platform.audit.record({
    action: 'credential_change',
    actor,
    target: providerId,
    detail: { operation: 'delete' },
  })
  return reply.status(204).send(noContent())
}

export async function sortProvidersHandler(
  request: FastifyRequest<RequestOf<typeof providerSortSchema>>,
  reply: FastifyReply
) {
  return reply.send(success(await request.server.ctx.workflows.providerManagement.sort(request.body.order)))
}

export async function testProviderHandler(
  request: FastifyRequest<RequestOf<typeof providerIdParamsSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.workflows.providerManagement.test(request.params.id)
  return reply.send(success(result))
}
