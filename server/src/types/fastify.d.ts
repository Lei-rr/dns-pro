import type { AppSession } from '../shared/auth/app-session.js'

declare module 'fastify' {
  interface FastifyRequest {
    session: AppSession
  }
}

export {}
