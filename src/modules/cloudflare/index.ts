import type { FastifyInstance } from 'fastify'
import { routes } from './routes.js'

export async function cloudflareModule(app: FastifyInstance) {
  await app.register(routes, { prefix: '/cloudflare/providers/:providerId' })
}
