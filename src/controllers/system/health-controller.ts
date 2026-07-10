import type { FastifyReply, FastifyRequest } from 'fastify'
import { success } from '../../support/api-response.js'

export async function healthShow(_request: FastifyRequest, reply: FastifyReply) {
  return reply.send(success({ status: 'ok' }))
}
