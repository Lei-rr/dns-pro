import type { FastifyInstance } from 'fastify'
import { noRequestSchema } from '../../lib/http/request-schema.js'
import { sessionStore, sessionShow, sessionDelete } from './controllers/session-controller.js'
import { sessionStoreSchema } from './schemas.js'

export async function routes(app: FastifyInstance) {
  app.post('/session', { schema: sessionStoreSchema }, sessionStore)
  app.get('/session', { schema: noRequestSchema }, sessionShow)
  app.delete('/session', { schema: noRequestSchema }, sessionDelete)
}
