import type { FastifyReply, FastifyRequest } from 'fastify'
import { noContent, success } from '../../shared/http/api-response.js'
import { ApiError } from '../../shared/http/api-error.js'
import { noRequestSchema, type RequestOf } from '../../shared/http/request-schema.js'
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
  return reply.status(201).send(success(provider))
}

export async function updateProviderHandler(
  request: FastifyRequest<RequestOf<typeof providerUpdateSchema>>,
  reply: FastifyReply
) {
  const provider = await request.server.ctx.workflows.providerManagement.update(request.params.id, request.body)
  return reply.send(success(provider))
}

export async function deleteProviderHandler(
  request: FastifyRequest<RequestOf<typeof providerIdParamsSchema>>,
  reply: FastifyReply
) {
  await request.server.ctx.workflows.providerManagement.delete(request.params.id)
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
