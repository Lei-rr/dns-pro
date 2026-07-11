import type { FastifyInstance } from 'fastify'
import { routes } from './routes.js'

export async function edgeoneModule(app: FastifyInstance) {
  await app.register(routes, { prefix: '/edgeone/providers/:providerId' })
}
