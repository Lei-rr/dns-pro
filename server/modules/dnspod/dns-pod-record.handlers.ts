import type { FastifyReply, FastifyRequest } from 'fastify'
import { success } from '../../core/http/api-response.js'
import { ownerOf } from '../../core/contracts/ownership.port.js'
import type { RequestOf } from '../../core/http/request-schema.js'
import {
  dnspodRecordParamsSchema,
  dnspodRecordsIndexSchema,
  dnspodRecordStoreSchema,
  dnspodRecordUpdateSchema,
} from './dns-pod.schema.js'

export async function listDnsPodRecordsHandler(
  request: FastifyRequest<RequestOf<typeof dnspodRecordsIndexSchema>>,
  reply: FastifyReply
) {
  const { providerId, zone } = request.params
  const result = await request.server.ctx.modules.dnsPod.records.list(providerId, zone, {
    refresh: request.query.refresh === 'true',
  })
  // F3：列表带 hostname 级归属徽标；归属查询失败不阻断列表（徽标降级为无）
  const claims = await request.server.ctx.modules.ownership
    .claimsFor({ providerType: 'dnspod', providerId, zone })
    .catch(() => [])
  return reply.send(
    success({
      ...result,
      items: result.items.map((item) => ({ ...item, owner: ownerOf(claims, recordFqdn(item.name, zone)).owner })),
    })
  )
}

/** 端口记录名（相对主机记录）→ FQDN */
function recordFqdn(name: unknown, zone: string): string {
  const sub = String(name ?? '').trim()
  return sub === '' || sub === '@' ? zone : `${sub}.${zone}`
}

export async function createDnsPodRecordHandler(
  request: FastifyRequest<RequestOf<typeof dnspodRecordStoreSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.dnsPod.records.create(
    request.params.providerId,
    request.params.zone,
    request.body
  )
  return reply.status(201).send(success(result))
}

export async function updateDnsPodRecordHandler(
  request: FastifyRequest<RequestOf<typeof dnspodRecordUpdateSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.dnsPod.records.update(
    request.params.providerId,
    request.params.zone,
    request.params.recordId,
    request.body
  )
  return reply.send(success(result))
}

export async function deleteDnsPodRecordHandler(
  request: FastifyRequest<RequestOf<typeof dnspodRecordParamsSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.dnsPod.records.delete(
    request.params.providerId,
    request.params.zone,
    request.params.recordId
  )
  return reply.send(success(result))
}
