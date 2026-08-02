import type { FastifyInstance } from 'fastify'
import { noRequestSchema } from '../../shared/http/request-schema.js'
import { getHealthHandler } from './system.handlers.js'

/** Public system routes (no auth). */
export async function routes(app: FastifyInstance) {
  app.get('/health', { schema: noRequestSchema }, getHealthHandler)
}
