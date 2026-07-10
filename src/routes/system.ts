import type { FastifyInstance } from 'fastify'
import { healthShow } from '../controllers/system/health-controller.js'

export async function systemRoutes(app: FastifyInstance) {
  app.get('/health', healthShow)
}
