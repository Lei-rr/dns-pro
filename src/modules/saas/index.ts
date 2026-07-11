import type { FastifyInstance } from 'fastify'
import { routes } from './routes.js'

export async function saasModule(app: FastifyInstance) {
  await app.register(routes)
}
