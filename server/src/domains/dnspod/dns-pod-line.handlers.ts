import type { FastifyReply, FastifyRequest } from 'fastify'
import { success } from '../../kernel/http/api-response.js'
import type { RequestOf } from '../../kernel/http/request-schema.js'
import type { dnspodLinesIndexSchema } from './dns-pod.schema.js'

export async function listDnsPodLinesHandler(
  request: FastifyRequest<RequestOf<typeof dnspodLinesIndexSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.modules.dnsPod.lines.lines(
    request.params.providerId,
    request.params.zone,
    request.query.refresh === 'true'
  )
  return reply.send(success(result))
}
