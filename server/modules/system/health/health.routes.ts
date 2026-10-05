import type { FastifyInstance } from 'fastify'
import { noRequestSchema } from '../../../core/http/request-schema.js'
import { getHealthHandler } from './health.handlers.js'

/** Public system routes (no auth). */
export async function routes(app: FastifyInstance) {
  app.get('/health', { schema: noRequestSchema }, getHealthHandler)
}
