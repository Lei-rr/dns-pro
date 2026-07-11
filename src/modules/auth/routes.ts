import type { FastifyInstance } from 'fastify'
import { loginSchema } from './schemas.js'
import { sessionStore, sessionShow, sessionDelete } from './controller.js'

export async function routes(app: FastifyInstance) {
  app.post(
    '/session',
    {
      schema: { body: loginSchema },
      config: {
        rateLimit: {
          max: 10,
        },
      },
    },
    sessionStore
  )
  app.get('/session', sessionShow)
  app.delete('/session', sessionDelete)
}
