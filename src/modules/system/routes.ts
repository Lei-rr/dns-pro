import type { FastifyInstance } from 'fastify'
import { healthShow } from './controller.js'

/** Public system routes (no auth). */
export async function routes(app: FastifyInstance) {
  app.get('/health', healthShow)
}
