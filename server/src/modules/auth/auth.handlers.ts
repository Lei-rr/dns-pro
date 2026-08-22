import type { FastifyReply, FastifyRequest } from 'fastify'
import { success, noContent } from '../../shared/http/api-response.js'
import { noRequestSchema, type RequestOf } from '../../shared/http/request-schema.js'
import { sessionStoreSchema } from './auth.schema.js'

export async function createSessionHandler(
  request: FastifyRequest<RequestOf<typeof sessionStoreSchema>>,
  reply: FastifyReply
) {
  const { username, password } = request.body
  const session = await request.server.ctx.modules.auth.session.login(request, username, password)
  return reply.send(success(session))
}

export async function getSessionHandler(
  request: FastifyRequest<RequestOf<typeof noRequestSchema>>,
  reply: FastifyReply
) {
  const session = await request.server.ctx.modules.auth.session.currentSession(request)
  return reply.send(success(session))
}

export async function deleteSessionHandler(
  request: FastifyRequest<RequestOf<typeof noRequestSchema>>,
  reply: FastifyReply
) {
  request.server.ctx.modules.auth.session.logout(request)
  return reply.status(204).send(noContent())
}
