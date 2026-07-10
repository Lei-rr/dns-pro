import type { FastifyRequest, FastifyReply } from 'fastify'
import { CloudflaredTunnelService } from '../../services/cloudflared/cloudflared-tunnel-service.js'
import { CloudflaredRouteService, type CloudflaredRoute } from '../../services/cloudflared/cloudflared-route-service.js'
import { success } from '../../support/api-response.js'
import type {
  CloudflaredTunnelCreateInput,
  CloudflaredRouteInput,
  CloudflaredRouteDeleteQuery,
  CloudflaredRouteUpdateQuery,
} from '../../schemas/cloudflared.js'

const tunnelService = new CloudflaredTunnelService()
const routeService = new CloudflaredRouteService()

function parseBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true'
  return false
}

export async function cloudflaredTunnelsIndex(
  request: FastifyRequest<{ Params: { providerId: string }; Querystring: Record<string, unknown> }>,
  reply: FastifyReply
) {
  const result = await tunnelService.list(request.params.providerId, parseBool(request.query.refresh))
  return reply.send(success(result))
}

export async function cloudflaredTunnelsStore(
  request: FastifyRequest<{ Params: { providerId: string }; Body: CloudflaredTunnelCreateInput }>,
  reply: FastifyReply
) {
  const result = await tunnelService.create(request.params.providerId, request.body.name.trim())
  return reply.status(201).send(success(result))
}

export async function cloudflaredTunnelShow(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string }; Querystring: Record<string, unknown> }>,
  reply: FastifyReply
) {
  const result = await tunnelService.show(request.params.providerId, request.params.tunnelId, parseBool(request.query.refresh))
  return reply.send(success(result))
}

export async function cloudflaredTunnelDelete(request: FastifyRequest<{ Params: { providerId: string; tunnelId: string } }>, reply: FastifyReply) {
  const result = await tunnelService.delete(request.params.providerId, request.params.tunnelId)
  return reply.send(success(result))
}

export async function cloudflaredTunnelToken(request: FastifyRequest<{ Params: { providerId: string; tunnelId: string } }>, reply: FastifyReply) {
  const result = await tunnelService.token(request.params.providerId, request.params.tunnelId)
  return reply.send(success(result))
}

export async function cloudflaredTunnelTokenRotate(request: FastifyRequest<{ Params: { providerId: string; tunnelId: string } }>, reply: FastifyReply) {
  const result = await tunnelService.rotateToken(request.params.providerId, request.params.tunnelId)
  return reply.send(success(result))
}

export async function cloudflaredTunnelConfigShow(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string }; Querystring: Record<string, unknown> }>,
  reply: FastifyReply
) {
  const result = await routeService.getConfig(request.params.providerId, request.params.tunnelId, parseBool(request.query.refresh))
  return reply.send(success(result))
}

function buildRoute(body: CloudflaredRouteInput): CloudflaredRoute {
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
  const result = await routeService.addRoute(request.params.providerId, request.params.tunnelId, buildRoute(request.body))
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
    buildRoute(request.body)
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
  const result = await routeService.deleteRoute(
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
  const result = await routeService.listZones(request.params.providerId, parseBool(request.query.refresh))
  return reply.send(success(result))
}
