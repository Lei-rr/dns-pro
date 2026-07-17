import type { FastifyInstance } from 'fastify'
import {
  healthShow,
  auditIndex,
  backupsIndex,
  backupsStore,
  backupsRestore,
} from './controller.js'
import { authRequired } from '../auth/hooks/auth-required.js'

/** Public: health. Auth: audit / backups. */
export async function routes(app: FastifyInstance) {
  app.get('/health', healthShow)

  await app.register(async (protectedApp) => {
    protectedApp.addHook('preHandler', authRequired)
    protectedApp.get('/audit', auditIndex)
    protectedApp.get('/backups', backupsIndex)
    protectedApp.post('/backups', backupsStore)
    protectedApp.post('/backups/restore', backupsRestore)
  })
}
