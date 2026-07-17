import type { FastifyInstance } from 'fastify'
import { healthShow, auditIndex } from './controller.js'
import { authRequired } from '../auth/hooks/auth-required.js'

/** Public: health. Auth: audit. */
export async function routes(app: FastifyInstance) {
  app.get('/health', healthShow)

  await app.register(async (protectedApp) => {
    protectedApp.addHook('preHandler', authRequired)
    protectedApp.get('/audit', auditIndex)
  })
}
