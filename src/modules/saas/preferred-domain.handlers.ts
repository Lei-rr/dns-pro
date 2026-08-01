import type { FastifyReply, FastifyRequest } from 'fastify'
import { noContent, success } from '../../shared/http/api-response.js'
import { noRequestSchema, type RequestOf } from '../../shared/http/request-schema.js'
import {
  saasPreferredDomainParamsSchema,
  saasPreferredDomainSortSchema,
  saasPreferredDomainUpdateSchema,
  saasPreferredDomainWriteSchema,
} from './saas.schema.js'

export async function listPreferredDomainsHandler(
  request: FastifyRequest<RequestOf<typeof noRequestSchema>>,
  reply: FastifyReply
) {
  const items = await request.server.ctx.modules.saas.preferredDomains.list()
  return reply.send(success({ items }))
}

export async function createPreferredDomainHandler(
  request: FastifyRequest<RequestOf<typeof saasPreferredDomainWriteSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.saas.preferredDomains.create(request.body.domain)
  return reply.status(201).send(success(result))
}

export async function updatePreferredDomainHandler(
  request: FastifyRequest<RequestOf<typeof saasPreferredDomainUpdateSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.saas.preferredDomains.rename(
    request.params.domain.trim(),
    request.body.domain
  )
  return reply.send(success(result))
}

export async function deletePreferredDomainHandler(
  request: FastifyRequest<RequestOf<typeof saasPreferredDomainParamsSchema>>,
  reply: FastifyReply
) {
  await request.server.ctx.modules.saas.preferredDomains.delete(request.params.domain.trim())
  return reply.status(204).send(noContent())
}

export async function sortPreferredDomainsHandler(
  request: FastifyRequest<RequestOf<typeof saasPreferredDomainSortSchema>>,
  reply: FastifyReply
) {
  const items = await request.server.ctx.modules.saas.preferredDomains.reorder(request.body.domains)
  return reply.send(success({ items }))
}
