import type { FastifyInstance } from 'fastify'
import { healthShow, auditIndex, backupsIndex, backupsStore, backupsRestore } from './controller.js'

export async function routes(app: FastifyInstance) {
  app.get('/health', healthShow)
  app.get('/audit', auditIndex)
  app.get('/backups', backupsIndex)
  app.post('/backups', backupsStore)
  app.post('/backups/restore', backupsRestore)
}
