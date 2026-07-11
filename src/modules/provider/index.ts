import type { FastifyInstance } from 'fastify'
import { routes } from './routes.js'

export async function providerModule(app: FastifyInstance) {
  await app.register(routes, { prefix: '/providers' })
}
