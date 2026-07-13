import type { FastifyInstance } from 'fastify'
import { sessionStore, sessionShow, sessionDelete } from './controller.js'

export async function routes(app: FastifyInstance) {
  app.post('/session', sessionStore)
  app.get('/session', sessionShow)
  app.delete('/session', sessionDelete)
}
