import type { FastifyInstance } from 'fastify'
import { noRequestSchema } from '../../shared/http/request-schema.js'
import { createSessionHandler, deleteSessionHandler, getSessionHandler } from './auth.handlers.js'
import { sessionStoreSchema } from './auth.schema.js'

export async function routes(app: FastifyInstance) {
  app.post(
    '/session',
    {
      schema: sessionStoreSchema,
      config: {
        rateLimit: {
          max: 5,
          timeWindow: 15 * 60 * 1000,
        },
      },
    },
    createSessionHandler
  )
  app.get('/session', { schema: noRequestSchema }, getSessionHandler)
  app.delete('/session', { schema: noRequestSchema }, deleteSessionHandler)
}
