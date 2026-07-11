import type { FastifyInstance } from 'fastify'
import { routes } from './routes.js'

export async function cloudflaredModule(app: FastifyInstance) {
  await app.register(routes, { prefix: '/cloudflared/providers/:providerId' })
}
