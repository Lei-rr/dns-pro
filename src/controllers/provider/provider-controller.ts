import type { FastifyRequest, FastifyReply } from 'fastify'
import { ProviderService } from '../../services/provider/provider-service.js'
import { success, noContent } from '../../support/api-response.js'
import { ApiError } from '../../support/api-error.js'
import type {
  ProviderStoreInput,
  ProviderUpdateInput,
  ProviderSortInput,
} from '../../schemas/provider.js'

const providerService = new ProviderService()

export async function definitionsIndex(_request: FastifyRequest, reply: FastifyReply) {
  return reply.send(success(providerService.definitions()))
}

export async function providerIndex(_request: FastifyRequest, reply: FastifyReply) {
  const providers = await providerService.all()
  return reply.send(success(providers))
}

export async function providerShow(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const provider = await providerService.find(request.params.id)
  if (!provider) {
    throw new ApiError('provider_not_found', 'Provider not found', 404)
  }
  return reply.send(success(provider))
}

export async function providerStore(request: FastifyRequest<{ Body: ProviderStoreInput }>, reply: FastifyReply) {
  const provider = await providerService.create(request.body as Record<string, unknown>)
  return reply.status(201).send(success(provider))
}

export async function providerUpdate(
  request: FastifyRequest<{ Params: { id: string }; Body: ProviderUpdateInput }>,
  reply: FastifyReply
) {
  const provider = await providerService.update(request.params.id, request.body as Record<string, unknown>)
  return reply.send(success(provider))
}

export async function providerDelete(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  await providerService.delete(request.params.id)
  return reply.status(204).send(noContent())
}

export async function providerSort(request: FastifyRequest<{ Body: ProviderSortInput }>, reply: FastifyReply) {
  const providers = await providerService.sort(request.body.order)
  return reply.send(success(providers))
}
