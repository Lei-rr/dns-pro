import type { FastifyInstance } from 'fastify'
import { noRequestSchema } from '../../../kernel/http/request-schema.js'
import { listAuditEventsHandler } from './audit.handlers.js'

/** 需登录：关键操作审计（F6） */
export async function routes(app: FastifyInstance): Promise<void> {
  app.get('/', { schema: noRequestSchema }, listAuditEventsHandler)
}
