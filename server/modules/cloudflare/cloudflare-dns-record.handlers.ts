import type { FastifyReply, FastifyRequest } from 'fastify'
import { success } from '../../core/http/api-response.js'
import { ownerOf } from '../../core/contracts/ownership.port.js'
import type { RequestOf } from '../../core/http/request-schema.js'
import {
  cloudflareRecordParamsSchema,
  cloudflareRecordsIndexSchema,
  cloudflareRecordUpdateSchema,
  cloudflareRecordWriteSchema,
} from './cloudflare.schema.js'

export async function listCloudflareRecordsHandler(
  request: FastifyRequest<RequestOf<typeof cloudflareRecordsIndexSchema>>,
  reply: FastifyReply
) {
  const { providerId, zone } = request.params
  const zoneId = await request.server.ctx.modules.cloudflare.zones.idByName(providerId, zone)
  const result = await request.server.ctx.modules.cloudflare.records.listAll(
    providerId,
    zoneId,
    request.query.refresh === 'true'
  )
  // F3：列表带 hostname 级归属徽标。归属查询失败不得降级成 manual：
  // manual 的语义是「无派生归属，自动化流程不会删除该记录」，与「暂时查不到」正好相反，
  // 上游限流时那样降级等于给用户一个错误保证。失败时本响应干脆不返回 owner 字段，前端按未知归属处理（不渲染徽标）。
  const claims = await request.server.ctx.modules.ownership
    .claimsFor({ providerType: 'cloudflare', providerId, zone })
    .catch((error: unknown) => {
      request.log.warn({ err: error, providerId, zone }, 'Cloudflare 记录归属查询失败：本次响应不返回归属徽标')
      return null
    })
  return reply.send(
    success({
      ...result,
      items: result.items.map((item) =>
        claims === null ? { ...item } : { ...item, owner: ownerOf(claims, String(item.name ?? '')).owner }
      ),
    })
  )
}

export async function createCloudflareRecordHandler(
  request: FastifyRequest<RequestOf<typeof cloudflareRecordWriteSchema>>,
  reply: FastifyReply
) {
  const zoneId = await request.server.ctx.modules.cloudflare.zones.idByName(
    request.params.providerId,
    request.params.zone
  )
  const result = await request.server.ctx.modules.cloudflare.records.create(
    request.params.providerId,
    zoneId,
    request.body
  )
  return reply.status(201).send(success(result))
}

export async function updateCloudflareRecordHandler(
  request: FastifyRequest<RequestOf<typeof cloudflareRecordUpdateSchema>>,
  reply: FastifyReply
) {
  const zoneId = await request.server.ctx.modules.cloudflare.zones.idByName(
    request.params.providerId,
    request.params.zone
  )
  const result = await request.server.ctx.modules.cloudflare.records.update(
    request.params.providerId,
    zoneId,
    request.params.recordId,
    request.body
  )
  return reply.send(success(result))
}

export async function deleteCloudflareRecordHandler(
  request: FastifyRequest<RequestOf<typeof cloudflareRecordParamsSchema>>,
  reply: FastifyReply
) {
  const zoneId = await request.server.ctx.modules.cloudflare.zones.idByName(
    request.params.providerId,
    request.params.zone
  )
  const result = await request.server.ctx.modules.cloudflare.records.delete(
    request.params.providerId,
    zoneId,
    request.params.recordId
  )
  return reply.send(success(result))
}
