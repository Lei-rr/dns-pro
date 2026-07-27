import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import { bodyRecord } from '../../../lib/utils/request-parse.js'

function parseRecords(body: Record<string, unknown>) {
  if (Array.isArray(body.records)) {
    return body.records.map((item) => {
      if (item && typeof item === 'object') {
        const row = item as Record<string, unknown>
        return {
          id: String(row.id ?? row.record_id ?? ''),
          name: String(row.name ?? row.subdomain ?? ''),
          type: String(row.type ?? row.record_type ?? ''),
          value: row.value !== undefined ? String(row.value) : row.content !== undefined ? String(row.content) : '',
          content: row.content !== undefined ? String(row.content) : row.value !== undefined ? String(row.value) : '',
          ttl: row.ttl as number | string | undefined,
          line: row.line !== undefined ? String(row.line) : row.record_line !== undefined ? String(row.record_line) : '',
          record_line:
            row.record_line !== undefined ? String(row.record_line) : row.line !== undefined ? String(row.line) : '',
          record_line_id: row.record_line_id !== undefined ? String(row.record_line_id) : '',
          mx: (row.mx ?? row.priority) as number | string | undefined,
          priority: (row.priority ?? row.mx) as number | string | undefined,
          remark: row.remark !== undefined ? String(row.remark) : row.comment !== undefined ? String(row.comment) : '',
          comment: row.comment !== undefined ? String(row.comment) : row.remark !== undefined ? String(row.remark) : '',
          proxied: row.proxied as boolean | undefined,
          subdomain: row.subdomain !== undefined ? String(row.subdomain) : String(row.name ?? ''),
          status: row.status !== undefined ? String(row.status) : '',
          weight: row.weight as number | string | undefined,
        }
      }
      return { id: String(item ?? ''), name: '', type: '' }
    })
  }
  if (Array.isArray(body.record_ids)) {
    return body.record_ids.map((id) => ({ id: String(id), name: '', type: '' }))
  }
  return []
}

export async function batchCreateStore(
  request: FastifyRequest<{ Params: { providerId: string; zone: string } }>,
  reply: FastifyReply,
) {
  const body = bodyRecord(request)
  const providerType = String(request.dnsProviderType || 'dnspod')
  const records = parseRecords(body)

  const result = await request.server.ctx.dnsBatchJobService.createCreate({
    providerType,
    providerId: request.params.providerId,
    zone: request.params.zone,
    zoneName: String(body.zone_name || request.params.zone),
    records,
  })
  return reply.status(201).send(success(result))
}

export async function batchDeleteStore(
  request: FastifyRequest<{ Params: { providerId: string; zone: string } }>,
  reply: FastifyReply,
) {
  const body = bodyRecord(request)
  const providerType = String(request.dnsProviderType || 'dnspod')
  const records = parseRecords(body)

  const result = await request.server.ctx.dnsBatchJobService.createDelete({
    providerType,
    providerId: request.params.providerId,
    zone: request.params.zone,
    records,
  })
  return reply.status(201).send(success(result))
}

export async function batchUpdateStore(
  request: FastifyRequest<{ Params: { providerId: string; zone: string } }>,
  reply: FastifyReply,
) {
  const body = bodyRecord(request)
  const providerType = String(request.dnsProviderType || 'dnspod')
  const records = parseRecords(body)
  const patch =
    body.patch && typeof body.patch === 'object' && !Array.isArray(body.patch)
      ? (body.patch as Record<string, unknown>)
      : (() => {
          const { records: _r, record_ids: _ids, patch: _p, ...rest } = body
          return rest
        })()

  const result = await request.server.ctx.dnsBatchJobService.createUpdate({
    providerType,
    providerId: request.params.providerId,
    zone: request.params.zone,
    records,
    patch,
  })
  return reply.status(201).send(success(result))
}

export async function batchJobShow(
  request: FastifyRequest<{ Params: { jobId: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.dnsBatchJobService.find(request.params.jobId)
  return reply.send(success(result))
}

export async function batchJobActive(
  request: FastifyRequest<{ Params: { providerId: string; zone: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.dnsBatchJobService.active(request.params.providerId, request.params.zone)
  return reply.send(success(result))
}

export async function batchJobRetry(
  request: FastifyRequest<{ Params: { jobId: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.dnsBatchJobService.retryFailed(request.params.jobId)
  return reply.send(success(result))
}
