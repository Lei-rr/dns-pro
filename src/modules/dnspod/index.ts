import type { FastifyInstance } from 'fastify'
import { routes } from './routes.js'

export async function dnspodModule(app: FastifyInstance) {
  await app.register(routes, { prefix: '/dnspod/providers/:providerId' })
}
