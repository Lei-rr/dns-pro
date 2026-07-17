import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import { bodyRecord } from '../../../lib/utils/request-parse.js'

export async function recordBatchDeleteStore(
  request: FastifyRequest<{ Params: { providerId: string; zone: string } }>,
  reply: FastifyReply,
) {
  const body = bodyRecord(request)
  const providerType = String((request as any).dnsProviderType || 'dnspod')
  const records = Array.isArray(body.records)
    ? body.records.map((item) => {
        if (item && typeof item === 'object') {
          const row = item as Record<string, unknown>
          return {
            id: String(row.id ?? row.record_id ?? ''),
            name: String(row.name ?? ''),
            type: String(row.type ?? ''),
          }
        }
        return { id: String(item ?? ''), name: '', type: '' }
      })
    : Array.isArray(body.record_ids)
      ? body.record_ids.map((id) => ({ id: String(id), name: '', type: '' }))
      : []

  const result = await request.server.ctx.dnsBatchJobService.createDelete({
    providerType,
    providerId: request.params.providerId,
    zone: request.params.zone,
    records,
  })
  return reply.status(201).send(success(result))
}

export async function recordBatchJobShow(
  request: FastifyRequest<{ Params: { jobId: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.dnsBatchJobService.find(request.params.jobId)
  return reply.send(success(result))
}

export async function recordBatchJobActive(
  request: FastifyRequest<{ Params: { providerId: string; zone: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.dnsBatchJobService.active(request.params.providerId, request.params.zone)
  return reply.send(success(result))
}

export async function recordBatchJobRetry(
  request: FastifyRequest<{ Params: { jobId: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.dnsBatchJobService.retryFailed(request.params.jobId)
  return reply.send(success(result))
}
