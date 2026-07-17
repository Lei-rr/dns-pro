import type { FastifyRequest, FastifyReply } from 'fastify'
import { success, noContent } from '../../lib/http/api-response.js'
import { ApiError } from '../../lib/http/api-error.js'
import { bodyRecord } from '../../lib/utils/request-parse.js'

export async function definitionsIndex(request: FastifyRequest, reply: FastifyReply) {
  return reply.send(success(request.server.ctx.providerService.definitions()))
}

export async function providerIndex(request: FastifyRequest, reply: FastifyReply) {
  const providers = await request.server.ctx.providerService.all()
  return reply.send(success(providers))
}

export async function providerShow(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const provider = await request.server.ctx.providerService.find(request.params.id)
  if (!provider) {
    throw new ApiError('provider_not_found', 'Provider not found', 404)
  }
  return reply.send(success(provider))
}

export async function providerStore(request: FastifyRequest<{ Body: any }>, reply: FastifyReply) {
  const provider = await request.server.ctx.providerMutationUseCase.create(bodyRecord(request))
  return reply.status(201).send(success(provider))
}

export async function providerUpdate(
  request: FastifyRequest<{ Params: { id: string }; Body: any }>,
  reply: FastifyReply,
) {
  const provider = await request.server.ctx.providerMutationUseCase.update(
    request.params.id,
    bodyRecord(request),
  )
  return reply.send(success(provider))
}

export async function providerDelete(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  await request.server.ctx.providerMutationUseCase.delete(request.params.id)
  return reply.status(204).send(noContent())
}

export async function providerSort(request: FastifyRequest<{ Body: any }>, reply: FastifyReply) {
  const body = bodyRecord(request)
  const order = Array.isArray(body.order) ? body.order.map(String) : []
  const providers = await request.server.ctx.providerMutationUseCase.sort(order)
  return reply.send(success(providers))
}
