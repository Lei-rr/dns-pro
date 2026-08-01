import type { FastifyReply, FastifyRequest } from 'fastify'
import { success } from '../../shared/http/api-response.js'
import type { RequestOf } from '../../shared/http/request-schema.js'
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
  const result = await request.server.ctx.modules.dnsPod.records.list(request.params.providerId, request.params.zone, {
    refresh: request.query.refresh === 'true',
  })
  return reply.send(success(result))
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
