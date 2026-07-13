import type { FastifyRequest, FastifyReply } from 'fastify'
import { success, noContent } from '../../lib/http/api-response.js'

export async function sessionStore(request: FastifyRequest<{ Body: any }>, reply: FastifyReply) {
  const body = (request.body ?? {}) as Record<string, any>
  const username = String(body.username ?? '')
  const password = String(body.password ?? '')
  const session = await request.server.ctx.sessionService.login(request, username, password)
  return reply.send(success(session))
}

export async function sessionShow(request: FastifyRequest, reply: FastifyReply) {
  return reply.send(success(request.server.ctx.sessionService.currentSession(request)))
}

export async function sessionDelete(request: FastifyRequest, reply: FastifyReply) {
  request.server.ctx.sessionService.logout(request)
  return reply.status(204).send(noContent())
}
