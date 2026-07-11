import type { FastifyRequest, FastifyReply } from 'fastify'
import type { CloudflaredRoute } from '../services/route-service.js'
import { success } from '../../../lib/http/api-response.js'
import type {
  CloudflaredTunnelCreateInput,
  CloudflaredRouteInput,
  CloudflaredRouteDeleteQuery,
  CloudflaredRouteUpdateQuery,
} from '../schemas/request.js'

function parseBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true'
  return false
}

export async function cloudflaredTunnelsIndex(
  request: FastifyRequest<{ Params: { providerId: string }; Querystring: Record<string, unknown> }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.cloudflaredTunnelService.list(
    request.params.providerId,
    parseBool(request.query.refresh)
  )
  return reply.send(success(result))
}

export async function cloudflaredTunnelsStore(
  request: FastifyRequest<{ Params: { providerId: string }; Body: CloudflaredTunnelCreateInput }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.cloudflaredTunnelService.create(
    request.params.providerId,
    request.body.name.trim()
  )
  return reply.status(201).send(success(result))
}

export async function cloudflaredTunnelShow(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string }; Querystring: Record<string, unknown> }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.cloudflaredTunnelService.show(
    request.params.providerId,
    request.params.tunnelId,
    parseBool(request.query.refresh)
  )
  return reply.send(success(result))
}

export async function cloudflaredTunnelDelete(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string } }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.cloudflaredTunnelService.delete(
    request.params.providerId,
    request.params.tunnelId
  )
  return reply.send(success(result))
}

export async function cloudflaredTunnelToken(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string } }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.cloudflaredTunnelService.token(
    request.params.providerId,
    request.params.tunnelId
  )
  return reply.send(success(result))
}

export async function cloudflaredTunnelTokenRotate(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string } }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.cloudflaredTunnelService.rotateToken(
    request.params.providerId,
    request.params.tunnelId
  )
  return reply.send(success(result))
}

export async function cloudflaredTunnelConfigShow(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string }; Querystring: Record<string, unknown> }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.cloudflaredRouteService.getConfig(
    request.params.providerId,
    request.params.tunnelId,
    parseBool(request.query.refresh)
  )
  return reply.send(success(result))
}

function buildRoute(
  routeService: { buildServiceUrl: (protocol: string, address: string) => string },
  body: CloudflaredRouteInput
): CloudflaredRoute {
  return {
    hostname: body.hostname,
    service: routeService.buildServiceUrl(body.protocol ?? 'http', body.address),
    zone_id: body.zone_id,
    path: body.path ?? '',
  }
}

export async function cloudflaredTunnelRouteStore(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string }; Body: CloudflaredRouteInput }>,
  reply: FastifyReply
) {
  const routeService = request.server.ctx.cloudflaredRouteService
  const result = await routeService.addRoute(
    request.params.providerId,
    request.params.tunnelId,
    buildRoute(routeService, request.body)
  )
  return reply.status(201).send(success(result))
}

export async function cloudflaredTunnelRouteUpdate(
  request: FastifyRequest<{
    Params: { providerId: string; tunnelId: string }
    Body: CloudflaredRouteInput
    Querystring: CloudflaredRouteUpdateQuery
  }>,
  reply: FastifyReply
) {
  const routeService = request.server.ctx.cloudflaredRouteService
  let originalHostname = (request.query.original_hostname ?? '').trim().toLowerCase()
  let originalPath = request.query.original_path ?? ''

  if (originalHostname === '') {
    originalHostname = request.body.hostname.toLowerCase().trim()
    originalPath = request.body.path ?? ''
  }

  const result = await routeService.updateRoute(
    request.params.providerId,
    request.params.tunnelId,
    originalHostname,
    originalPath,
    buildRoute(routeService, request.body)
  )
  return reply.send(success(result))
}

export async function cloudflaredTunnelRouteDelete(
  request: FastifyRequest<{
    Params: { providerId: string; tunnelId: string }
    Querystring: CloudflaredRouteDeleteQuery
  }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.cloudflaredRouteService.deleteRoute(
    request.params.providerId,
    request.params.tunnelId,
    request.query.hostname,
    request.query.path ?? '',
    request.query.zone_id
  )
  return reply.send(success(result))
}

export async function cloudflaredZonesIndex(
  request: FastifyRequest<{ Params: { providerId: string }; Querystring: Record<string, unknown> }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.cloudflaredRouteService.listZones(
    request.params.providerId,
    parseBool(request.query.refresh)
  )
  return reply.send(success(result))
}
