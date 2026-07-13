import type { FastifyRequest, FastifyReply } from 'fastify'
import { success, noContent } from '../../lib/http/api-response.js'
import { ApiError } from '../../lib/http/api-error.js'

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
  const provider = await request.server.ctx.providerService.create(((request.body ?? {}) as any) as Record<string, unknown>)
  return reply.status(201).send(success(provider))
}

export async function providerUpdate(
  request: FastifyRequest<{ Params: { id: string }; Body: any }>,
  reply: FastifyReply
) {
  const provider = await request.server.ctx.providerService.update(
    request.params.id,
    ((request.body ?? {}) as any) as Record<string, unknown>
  )
  return reply.send(success(provider))
}

export async function providerDelete(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  await request.server.ctx.providerService.delete(request.params.id)
  return reply.status(204).send(noContent())
}

export async function providerSort(request: FastifyRequest<{ Body: any }>, reply: FastifyReply) {
  const body: any = request.body ?? {}
  const providers = await request.server.ctx.providerService.sort(body.order)
  return reply.send(success(providers))
}
