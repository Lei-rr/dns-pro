import type { FastifyRequest, FastifyReply } from 'fastify'
import { SessionService } from '../../services/session-service.js'
import { success, noContent } from '../../support/api-response.js'
import type { LoginInput } from '../../schemas/session.js'

const sessionService = new SessionService()

export async function sessionStore(request: FastifyRequest<{ Body: LoginInput }>, reply: FastifyReply) {
  const { username, password } = request.body
  const session = await sessionService.login(request, username, password)
  return reply.send(success(session))
}

export async function sessionShow(request: FastifyRequest, reply: FastifyReply) {
  return reply.send(success(sessionService.currentSession(request)))
}

export async function sessionDelete(request: FastifyRequest, reply: FastifyReply) {
  sessionService.logout(request)
  return reply.status(204).send(noContent())
}
