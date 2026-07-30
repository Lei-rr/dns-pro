import type { FastifyInstance } from 'fastify'
import { noRequestSchema } from '../../lib/http/request-schema.js'
import { healthShow } from './controllers/health-controller.js'

/** Public system routes (no auth). */
export async function routes(app: FastifyInstance) {
  app.get('/health', { schema: noRequestSchema }, healthShow)
}
