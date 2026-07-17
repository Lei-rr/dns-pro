import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import { parseBool } from '../../../lib/utils/parse-bool.js'
import { CloudflaredServiceTokens } from '../plugin.js'
import type { CloudflaredTunnelService } from '../services/tunnel-service.js'
import type { CloudflaredRouteService } from '../services/route-service.js'

function tunnelsOf(request: FastifyRequest): CloudflaredTunnelService {
  return request.server.ctx.registry.require<CloudflaredTunnelService>(CloudflaredServiceTokens.Tunnels)
}

function routesOf(request: FastifyRequest): CloudflaredRouteService {
  return request.server.ctx.registry.require<CloudflaredRouteService>(CloudflaredServiceTokens.Routes)
}

export async function cloudflaredTunnelsIndex(
  request: FastifyRequest<{ Params: { providerId: string }; Querystring: any }>,
  reply: FastifyReply,
) {
  const result = await tunnelsOf(request).list(
    request.params.providerId,
    parseBool((request.query as any).refresh),
  )
  return reply.send(success(result))
}

export async function cloudflaredTunnelsStore(
  request: FastifyRequest<{ Params: { providerId: string }; Body: any }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.tunnelMutationUseCase.createTunnel(
    request.params.providerId,
    String(((request.body ?? {}) as any).name ?? '').trim(),
  )
  return reply.status(201).send(success(result))
}

export async function cloudflaredTunnelShow(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string }; Querystring: any }>,
  reply: FastifyReply,
) {
  const result = await tunnelsOf(request).show(
    request.params.providerId,
    request.params.tunnelId,
    parseBool((request.query as any).refresh),
  )
  return reply.send(success(result))
}

export async function cloudflaredTunnelDelete(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.tunnelMutationUseCase.deleteTunnel(
    request.params.providerId,
    request.params.tunnelId,
  )
  return reply.send(success(result))
}

export async function cloudflaredTunnelToken(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.tunnelMutationUseCase.token(
    request.params.providerId,
    request.params.tunnelId,
  )
  return reply.send(success(result))
}

export async function cloudflaredTunnelTokenRotate(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.tunnelMutationUseCase.rotateToken(
    request.params.providerId,
    request.params.tunnelId,
  )
  return reply.send(success(result))
}

export async function cloudflaredTunnelConfigShow(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string }; Querystring: any }>,
  reply: FastifyReply,
) {
  const result = await routesOf(request).getConfig(
    request.params.providerId,
    request.params.tunnelId,
    parseBool((request.query as any).refresh),
  )
  return reply.send(success(result))
}

function buildRoute(
  request: FastifyRequest,
  body: any,
): Record<string, unknown> {
  return {
    hostname: body.hostname,
    service: request.server.ctx.tunnelMutationUseCase.buildServiceUrl(
      body.protocol ?? 'http',
      body.address,
    ),
    zone_id: body.zone_id,
    path: body.path ?? '',
  }
}

export async function cloudflaredTunnelRouteStore(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string }; Body: any }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.tunnelMutationUseCase.addRoute(
    request.params.providerId,
    request.params.tunnelId,
    buildRoute(request, request.body),
  )
  return reply.status(201).send(success(result))
}

export async function cloudflaredTunnelRouteUpdate(
  request: FastifyRequest<{
    Params: { providerId: string; tunnelId: string }
    Body: any
    Querystring: any
  }>,
  reply: FastifyReply,
) {
  let originalHostname = ((request.query as any).original_hostname ?? '').trim().toLowerCase()
  let originalPath = (request.query as any).original_path ?? ''

  if (originalHostname === '') {
    originalHostname = String(((request.body ?? {}) as any).hostname ?? '').toLowerCase().trim()
    originalPath = ((request.body ?? {}) as any).path ?? ''
  }

  const result = await request.server.ctx.tunnelMutationUseCase.updateRoute(
    request.params.providerId,
    request.params.tunnelId,
    originalHostname,
    originalPath,
    buildRoute(request, request.body),
  )
  return reply.send(success(result))
}

export async function cloudflaredTunnelRouteDelete(
  request: FastifyRequest<{
    Params: { providerId: string; tunnelId: string }
    Querystring: any
  }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.tunnelMutationUseCase.deleteRoute(
    request.params.providerId,
    request.params.tunnelId,
    (request.query as any).hostname,
    (request.query as any).path ?? '',
    (request.query as any).zone_id,
  )
  return reply.send(success(result))
}

export async function cloudflaredZonesIndex(
  request: FastifyRequest<{ Params: { providerId: string }; Querystring: any }>,
  reply: FastifyReply,
) {
  const result = await routesOf(request).listZones(
    request.params.providerId,
    parseBool((request.query as any).refresh),
  )
  return reply.send(success(result))
}
