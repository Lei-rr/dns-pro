import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import { parseBool } from '../../../lib/utils/parse-bool.js'


export async function cloudflaredTunnelsIndex(
  request: FastifyRequest<{ Params: { providerId: string }; Querystring: any }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.cloudflaredTunnelService.list(
    request.params.providerId,
    parseBool((request.query as any).refresh)
  )
  return reply.send(success(result))
}

export async function cloudflaredTunnelsStore(
  request: FastifyRequest<{ Params: { providerId: string }; Body: any }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.cloudflaredTunnelService.create(
    request.params.providerId,
    String(((request.body ?? {}) as any).name ?? "").trim()
  )
  return reply.status(201).send(success(result))
}

export async function cloudflaredTunnelShow(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string }; Querystring: any }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.cloudflaredTunnelService.show(
    request.params.providerId,
    request.params.tunnelId,
    parseBool((request.query as any).refresh)
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
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string }; Querystring: any }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.cloudflaredRouteService.getConfig(
    request.params.providerId,
    request.params.tunnelId,
    parseBool((request.query as any).refresh)
  )
  return reply.send(success(result))
}

function buildRoute(
  routeService: { buildServiceUrl: (protocol: string, address: string) => string },
  body: any
): any {
  return {
    hostname: body.hostname,
    service: routeService.buildServiceUrl(body.protocol ?? 'http', body.address),
    zone_id: body.zone_id,
    path: body.path ?? '',
  }
}

export async function cloudflaredTunnelRouteStore(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string }; Body: any }>,
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
    Body: any
    Querystring: any
  }>,
  reply: FastifyReply
) {
  const routeService = request.server.ctx.cloudflaredRouteService
  let originalHostname = ((request.query as any).original_hostname ?? '').trim().toLowerCase()
  let originalPath = (request.query as any).original_path ?? ''

  if (originalHostname === '') {
    originalHostname = String(((request.body ?? {}) as any).hostname ?? "").toLowerCase().trim()
    originalPath = ((request.body ?? {}) as any).path ?? ''
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
    Querystring: any
  }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.cloudflaredRouteService.deleteRoute(
    request.params.providerId,
    request.params.tunnelId,
    (request.query as any).hostname,
    (request.query as any).path ?? '',
    (request.query as any).zone_id
  )
  return reply.send(success(result))
}

export async function cloudflaredZonesIndex(
  request: FastifyRequest<{ Params: { providerId: string }; Querystring: any }>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.cloudflaredRouteService.listZones(
    request.params.providerId,
    parseBool((request.query as any).refresh)
  )
  return reply.send(success(result))
}
