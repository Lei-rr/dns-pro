import type { FastifyRequest, FastifyReply } from 'fastify'
import { success, noContent } from '../../../lib/http/api-response.js'
import { bodyRecord } from '../../../lib/utils/request-parse.js'

export async function preferredDomainsIndex(request: FastifyRequest, reply: FastifyReply) {
  const items = await request.server.ctx.preferredDomainService.list()
  return reply.send(success({ items }))
}

export async function preferredDomainsStore(request: FastifyRequest, reply: FastifyReply) {
  const body = bodyRecord(request)
  const result = await request.server.ctx.preferredDomainService.create(String(body.domain ?? ''))
  return reply.status(201).send(success(result))
}

export async function preferredDomainsUpdate(
  request: FastifyRequest<{ Params: { domain: string } }>,
  reply: FastifyReply,
) {
  const body = bodyRecord(request)
  const result = await request.server.ctx.preferredDomainService.rename(
    decodeURIComponent(request.params.domain).trim(),
    String(body.domain ?? ''),
  )
  return reply.send(success(result))
}

export async function preferredDomainsDelete(
  request: FastifyRequest<{ Params: { domain: string } }>,
  reply: FastifyReply,
) {
  await request.server.ctx.preferredDomainService.delete(decodeURIComponent(request.params.domain).trim())
  return reply.status(204).send(noContent())
}

export async function preferredDomainsSort(request: FastifyRequest, reply: FastifyReply) {
  const body = bodyRecord(request)
  const domains = Array.isArray(body.domains) ? body.domains.map(String) : []
  const items = await request.server.ctx.preferredDomainService.reorder(domains)
  return reply.send(success({ items }))
}
