import type { FastifyReply, FastifyRequest } from 'fastify'
import { success } from '../../../kernel/http/api-response.js'
import { noRequestSchema, type RequestOf } from '../../../kernel/http/request-schema.js'
import type { AuditEvent } from '../../../kernel/observability/audit-log.js'

/** F6：关键操作留痕的查询入口（批量 / 凭据变更 / 会话吊销） */
export async function listAuditEventsHandler(
  request: FastifyRequest<RequestOf<typeof noRequestSchema>>,
  reply: FastifyReply
) {
  const events: AuditEvent[] = request.server.ctx.platform.audit.list()
  return reply.send(success({ items: events }))
}
