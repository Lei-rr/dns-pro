import type { FastifyRequest, FastifyReply } from 'fastify'
import { CloudflareZoneService } from '../../services/cloudflare/cloudflare-zone-service.js'
import { CloudflareDnsRecordService } from '../../services/cloudflare/cloudflare-dns-record-service.js'
import { success } from '../../support/api-response.js'
import type {
  CloudflareRecordListQuery,
  CloudflareRecordStoreInput,
  CloudflareRecordUpdateInput,
} from '../../schemas/cloudflare.js'

const zoneService = new CloudflareZoneService()
const recordService = new CloudflareDnsRecordService()

export async function recordIndex(
  request: FastifyRequest<{
    Params: { providerId: string; zone: string }
    Querystring: CloudflareRecordListQuery
  }>,
  reply: FastifyReply
) {
  const { providerId, zone } = request.params
  const zoneId = await zoneService.idByName(providerId, zone)

  const result = await recordService.list(providerId, zoneId, request.query)
  return reply.send(success(result))
}

export async function recordStore(
  request: FastifyRequest<{
    Params: { providerId: string; zone: string }
    Body: CloudflareRecordStoreInput
  }>,
  reply: FastifyReply
) {
  const { providerId, zone } = request.params
  const zoneId = await zoneService.idByName(providerId, zone)

  const result = await recordService.create(providerId, zoneId, request.body)
  return reply.status(201).send(success(result))
}

export async function recordUpdate(
  request: FastifyRequest<{
    Params: { providerId: string; zone: string; recordId: string }
    Body: CloudflareRecordUpdateInput
  }>,
  reply: FastifyReply
) {
  const { providerId, zone, recordId } = request.params
  const zoneId = await zoneService.idByName(providerId, zone)

  const result = await recordService.update(providerId, zoneId, recordId, request.body)
  return reply.send(success(result))
}

export async function recordDelete(
  request: FastifyRequest<{ Params: { providerId: string; zone: string; recordId: string } }>,
  reply: FastifyReply
) {
  const { providerId, zone, recordId } = request.params
  const zoneId = await zoneService.idByName(providerId, zone)

  const result = await recordService.delete(providerId, zoneId, recordId)
  return reply.send(success(result))
}
