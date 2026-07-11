import type { FastifyInstance } from 'fastify'
import { healthShow } from './controller.js'

export async function routes(app: FastifyInstance) {
  app.get('/health', healthShow)
}
