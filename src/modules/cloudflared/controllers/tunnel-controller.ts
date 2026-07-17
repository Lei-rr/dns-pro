import type { CloudflaredRouteService } from '../services/route-service.js'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import {
  bodyRecord,
  bodyString,
  queryBool,
  queryRecord,
  queryString,
} from '../../../lib/utils/request-parse.js'

export async function cloudflaredTunnelsIndex(
  request: FastifyRequest<{ Params: { providerId: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const result = await request.server.ctx.cloudflaredTunnelService.list(
    request.params.providerId,
    queryBool(q, 'refresh'),
  )
  return reply.send(success(result))
}

export async function cloudflaredTunnelsStore(
  request: FastifyRequest<{ Params: { providerId: string } }>,
  reply: FastifyReply,
) {
  const body = bodyRecord(request)
  const result = await request.server.ctx.cloudflaredTunnelService.create(
    request.params.providerId,
    bodyString(body, 'name'),
  )
  return reply.status(201).send(success(result))
}

export async function cloudflaredTunnelShow(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const result = await request.server.ctx.cloudflaredTunnelService.show(
    request.params.providerId,
    request.params.tunnelId,
    queryBool(q, 'refresh'),
  )
  return reply.send(success(result))
}

export async function cloudflaredTunnelDelete(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.cloudflaredTunnelService.delete(
    request.params.providerId,
    request.params.tunnelId,
  )
  return reply.send(success(result))
}

export async function cloudflaredTunnelToken(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.cloudflaredTunnelService.token(
    request.params.providerId,
    request.params.tunnelId,
  )
  return reply.send(success(result))
}

export async function cloudflaredTunnelTokenRotate(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.cloudflaredTunnelService.rotateToken(
    request.params.providerId,
    request.params.tunnelId,
  )
  return reply.send(success(result))
}

export async function cloudflaredTunnelConfigShow(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const result = await request.server.ctx.cloudflaredRouteService.getConfig(
    request.params.providerId,
    request.params.tunnelId,
    queryBool(q, 'refresh'),
  )
  return reply.send(success(result))
}

function buildRoute(routeService: CloudflaredRouteService, body: Record<string, unknown>) {
  return {
    hostname: bodyString(body, 'hostname'),
    service: routeService.buildServiceUrl(
      bodyString(body, 'protocol', 'http'),
      bodyString(body, 'address'),
    ),
    zone_id: bodyString(body, 'zone_id') || undefined,
    path: bodyString(body, 'path'),
  }
}

export async function cloudflaredTunnelRouteStore(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string } }>,
  reply: FastifyReply,
) {
  const routeService = request.server.ctx.cloudflaredRouteService
  const body = bodyRecord(request)
  const result = await routeService.addRoute(
    request.params.providerId,
    request.params.tunnelId,
    buildRoute(routeService, body),
  )
  return reply.status(201).send(success(result))
}

export async function cloudflaredTunnelRouteUpdate(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const body = bodyRecord(request)

  let originalHostname = queryString(q, 'original_hostname').toLowerCase()
  let originalPath = queryString(q, 'original_path')
  if (originalHostname === '') {
    originalHostname = bodyString(body, 'hostname').toLowerCase()
    originalPath = bodyString(body, 'path')
  }

  const routeService = request.server.ctx.cloudflaredRouteService
  const result = await routeService.updateRoute(
    request.params.providerId,
    request.params.tunnelId,
    originalHostname,
    originalPath,
    buildRoute(routeService, body),
  )
  return reply.send(success(result))
}

export async function cloudflaredTunnelRouteDelete(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const result = await request.server.ctx.cloudflaredRouteService.deleteRoute(
    request.params.providerId,
    request.params.tunnelId,
    queryString(q, 'hostname'),
    queryString(q, 'path'),
    queryString(q, 'zone_id'),
  )
  return reply.send(success(result))
}

export async function cloudflaredZonesIndex(
  request: FastifyRequest<{ Params: { providerId: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const result = await request.server.ctx.cloudflaredRouteService.listZones(
    request.params.providerId,
    queryBool(q, 'refresh'),
  )
  return reply.send(success(result))
}
