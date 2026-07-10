import type { FastifyRequest, FastifyReply } from 'fastify'
import { PreferredDomainService } from '../../services/saas/preferred-domain-service.js'
import { success, noContent } from '../../support/api-response.js'
import type { PreferredDomainStoreInput, PreferredDomainUpdateInput, PreferredDomainSortInput } from '../../schemas/saas.js'

const preferredDomainService = new PreferredDomainService()

export async function preferredDomainsIndex(_request: FastifyRequest, reply: FastifyReply) {
  const items = await preferredDomainService.list()
  return reply.send(success({ items }))
}

export async function preferredDomainsStore(request: FastifyRequest<{ Body: PreferredDomainStoreInput }>, reply: FastifyReply) {
  const result = await preferredDomainService.create(request.body.domain)
  return reply.status(201).send(success(result))
}

export async function preferredDomainsUpdate(
  request: FastifyRequest<{ Params: { domain: string }; Body: PreferredDomainUpdateInput }>,
  reply: FastifyReply
) {
  const result = await preferredDomainService.rename(decodeURIComponent(request.params.domain).trim(), request.body.domain)
  return reply.send(success(result))
}

export async function preferredDomainsDelete(request: FastifyRequest<{ Params: { domain: string } }>, reply: FastifyReply) {
  await preferredDomainService.delete(decodeURIComponent(request.params.domain).trim())
  return reply.status(204).send(noContent())
}

export async function preferredDomainsSort(request: FastifyRequest<{ Body: PreferredDomainSortInput }>, reply: FastifyReply) {
  const items = await preferredDomainService.reorder(request.body.domains)
  return reply.send(success({ items }))
}
