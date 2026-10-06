import type { FastifyReply, FastifyRequest } from 'fastify'
import { success } from '../../../core/http/api-response.js'
import type { RequestOf } from '../../../core/http/request-schema.js'
import {
  cloudflaredRouteDeleteSchema,
  cloudflaredRouteRepairSchema,
  cloudflaredRouteStoreSchema,
  cloudflaredRouteUpdateSchema,
  cloudflaredRoutesShowSchema,
  cloudflaredTunnelParamsSchema,
  cloudflaredTunnelShowSchema,
  cloudflaredTunnelStoreSchema,
  cloudflaredTunnelsIndexSchema,
} from './tunnel.schema.js'

export async function listTunnelsHandler(
  request: FastifyRequest<RequestOf<typeof cloudflaredTunnelsIndexSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.tunnels.tunnels.list(
    request.params.providerId,
    request.query.refresh === 'true'
  )
  return reply.send(success(result))
}

/**
 * 注意：本模块的副作用（side_effects）随业务字段一起放在 data 下，与全仓其它 handler 一致；
 * 前端经 shared/lib/side-effects.ts 的 readSideEffect 统一读取。api-response 的 success(data, sideEffects)
 * 虽然支持顶层承载，但目前没有任何调用方使用，贸然在本模块单独切过去会造成半统一。
 */
export async function createTunnelHandler(
  request: FastifyRequest<RequestOf<typeof cloudflaredTunnelStoreSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.tunnels.tunnels.create(request.params.providerId, request.body.name)
  return reply.status(201).send(success(result))
}

export async function getTunnelHandler(
  request: FastifyRequest<RequestOf<typeof cloudflaredTunnelShowSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.tunnels.tunnels.show(
    request.params.providerId,
    request.params.tunnelId,
    request.query.refresh === 'true'
  )
  return reply.send(success(result))
}

export async function deleteTunnelHandler(
  request: FastifyRequest<RequestOf<typeof cloudflaredTunnelParamsSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.tunnels.tunnels.delete(
    request.params.providerId,
    request.params.tunnelId
  )
  return reply.send(success(result))
}

export async function getTunnelTokenHandler(
  request: FastifyRequest<RequestOf<typeof cloudflaredTunnelParamsSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.tunnels.tunnels.token(
    request.params.providerId,
    request.params.tunnelId
  )
  return reply.send(success(result))
}

export async function rotateTunnelTokenHandler(
  request: FastifyRequest<RequestOf<typeof cloudflaredTunnelParamsSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.tunnels.tunnels.rotateToken(
    request.params.providerId,
    request.params.tunnelId
  )
  return reply.send(success(result))
}

export async function getTunnelConfigHandler(
  request: FastifyRequest<RequestOf<typeof cloudflaredRoutesShowSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.tunnels.routes.getConfig(
    request.params.providerId,
    request.params.tunnelId,
    request.query.refresh === 'true'
  )
  return reply.send(success(result))
}

function routeFromBody(body: { hostname: string; service: string; path?: string }) {
  return { hostname: body.hostname, service: body.service, path: body.path || '' }
}

export async function createTunnelRouteHandler(
  request: FastifyRequest<RequestOf<typeof cloudflaredRouteStoreSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.tunnels.routes.addRoute(
    request.params.providerId,
    request.params.tunnelId,
    routeFromBody(request.body)
  )
  return reply.status(201).send(success(result))
}

export async function updateTunnelRouteHandler(
  request: FastifyRequest<RequestOf<typeof cloudflaredRouteUpdateSchema>>,
  reply: FastifyReply
) {
  const originalHostname = (request.query.original_hostname || request.body.hostname).toLowerCase()
  const originalPath = request.query.original_hostname ? request.query.original_path || '' : request.body.path || ''
  const result = await request.server.ctx.modules.tunnels.routes.updateRoute(
    request.params.providerId,
    request.params.tunnelId,
    originalHostname,
    originalPath,
    routeFromBody(request.body)
  )
  return reply.send(success(result))
}

export async function deleteTunnelRouteHandler(
  request: FastifyRequest<RequestOf<typeof cloudflaredRouteDeleteSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.tunnels.routes.deleteRoute(
    request.params.providerId,
    request.params.tunnelId,
    request.query.hostname,
    request.query.path || ''
  )
  return reply.send(success(result))
}

export async function repairTunnelRouteHandler(
  request: FastifyRequest<RequestOf<typeof cloudflaredRouteRepairSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.tunnels.routes.repairRoutes(
    request.params.providerId,
    request.params.tunnelId
  )
  return reply.send(success(result))
}
