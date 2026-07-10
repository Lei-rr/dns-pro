import type { FastifyInstance } from 'fastify'
import { loginSchema } from '../schemas/session.js'
import { sessionStore, sessionShow, sessionDelete } from '../controllers/auth/session-controller.js'

export async function authRoutes(app: FastifyInstance) {
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
