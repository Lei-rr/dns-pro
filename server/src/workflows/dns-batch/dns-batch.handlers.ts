import type { FastifyReply, FastifyRequest } from 'fastify'
import { success } from '../../shared/http/api-response.js'
import type { RequestOf } from '../../shared/http/request-schema.js'
import type { DnsProviderType } from './dns-batch.routes.js'
import type { BatchRecordInput } from './dns-record-payload.js'
import {
  dnsBatchCreateSchema,
  dnsBatchDeleteSchema,
  dnsBatchUpdateSchema,
  dnsJobParamsSchema,
  dnsZoneParamsSchema,
} from './dns-batch.schema.js'

export function createDnsBatchHandler(providerType: DnsProviderType) {
  return async function createDnsBatch(
    request: FastifyRequest<RequestOf<typeof dnsBatchCreateSchema>>,
    reply: FastifyReply
  ) {
    const result = await request.server.ctx.workflows.dnsBatch.createCreate({
      providerType,
      providerId: request.params.providerId,
      zone: request.params.zone,
      records: request.body.records as BatchRecordInput[],
    })
    return reply.status(201).send(success(result))
  }
}

export function deleteDnsBatchHandler(providerType: DnsProviderType) {
  return async function deleteDnsBatch(
    request: FastifyRequest<RequestOf<typeof dnsBatchDeleteSchema>>,
    reply: FastifyReply
  ) {
    const result = await request.server.ctx.workflows.dnsBatch.createDelete({
      providerType,
      providerId: request.params.providerId,
      zone: request.params.zone,
      records: request.body.records,
    })
    return reply.status(201).send(success(result))
  }
}

export function updateDnsBatchHandler(providerType: DnsProviderType) {
  return async function updateDnsBatch(
    request: FastifyRequest<RequestOf<typeof dnsBatchUpdateSchema>>,
    reply: FastifyReply
  ) {
    const result = await request.server.ctx.workflows.dnsBatch.createUpdate({
      providerType,
      providerId: request.params.providerId,
      zone: request.params.zone,
      records: request.body.records as BatchRecordInput[],
      patch: request.body.patch,
    })
    return reply.status(201).send(success(result))
  }
}

export function getDnsBatchHandler(providerType: DnsProviderType) {
  return async function getDnsBatch(
    request: FastifyRequest<RequestOf<typeof dnsJobParamsSchema>>,
    reply: FastifyReply
  ) {
    return reply.send(
      success(
        await request.server.ctx.workflows.dnsBatch.find(request.params.jobId, providerType, request.params.providerId)
      )
    )
  }
}

export function getActiveDnsBatchHandler(providerType: DnsProviderType) {
  return async function getActiveDnsBatch(
    request: FastifyRequest<RequestOf<typeof dnsZoneParamsSchema>>,
    reply: FastifyReply
  ) {
    return reply.send(
      success(
        await request.server.ctx.workflows.dnsBatch.active(providerType, request.params.providerId, request.params.zone)
      )
    )
  }
}

export function retryDnsBatchHandler(providerType: DnsProviderType) {
  return async function retryDnsBatch(
    request: FastifyRequest<RequestOf<typeof dnsJobParamsSchema>>,
    reply: FastifyReply
  ) {
    return reply.send(
      success(
        await request.server.ctx.workflows.dnsBatch.retryFailed(
          request.params.jobId,
          providerType,
          request.params.providerId
        )
      )
    )
  }
}
