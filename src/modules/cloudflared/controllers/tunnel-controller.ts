import type { FastifyRequest, FastifyReply } from 'fastify'
import { success } from '../../../lib/http/api-response.js'
import {
  bodyRecord,
  bodyString,
  queryBool,
  queryRecord,
  queryString,
} from '../../../lib/utils/request-parse.js'

export async function tunnelsIndex(
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

export async function tunnelsStore(
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

export async function tunnelShow(
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

export async function tunnelDelete(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.cloudflaredTunnelService.delete(
    request.params.providerId,
    request.params.tunnelId,
  )
  return reply.send(success(result))
}

export async function tunnelToken(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.cloudflaredTunnelService.token(
    request.params.providerId,
    request.params.tunnelId,
  )
  return reply.send(success(result))
}

export async function tunnelTokenRotate(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string } }>,
  reply: FastifyReply,
) {
  const result = await request.server.ctx.cloudflaredTunnelService.rotateToken(
    request.params.providerId,
    request.params.tunnelId,
  )
  return reply.send(success(result))
}

export async function tunnelConfigShow(
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

function buildRoute(body: Record<string, unknown>) {
  return {
    hostname: bodyString(body, 'hostname'),
    service: bodyString(body, 'service'),
    path: bodyString(body, 'path'),
  }
}

export async function tunnelRouteStore(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string } }>,
  reply: FastifyReply,
) {
  const routeService = request.server.ctx.cloudflaredRouteService
  const body = bodyRecord(request)
  const result = await routeService.addRoute(
    request.params.providerId,
    request.params.tunnelId,
    buildRoute(body),
  )
  return reply.status(201).send(success(result))
}

export async function tunnelRouteUpdate(
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
    buildRoute(body),
  )
  return reply.send(success(result))
}

export async function tunnelRouteDelete(
  request: FastifyRequest<{ Params: { providerId: string; tunnelId: string } }>,
  reply: FastifyReply,
) {
  const q = queryRecord(request)
  const result = await request.server.ctx.cloudflaredRouteService.deleteRoute(
    request.params.providerId,
    request.params.tunnelId,
    queryString(q, 'hostname'),
    queryString(q, 'path'),
  )
  return reply.send(success(result))
}
