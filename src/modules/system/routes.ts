import type { FastifyInstance } from 'fastify'
import { healthShow, auditIndex } from './controller.js'

/** Public system routes (no auth). */
export async function routes(app: FastifyInstance) {
  app.get('/health', healthShow)
}

/** Authenticated system routes — mounted inside compose auth envelope. */
export async function protectedRoutes(app: FastifyInstance) {
  app.get('/audit', auditIndex)
}
