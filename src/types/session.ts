import type { AppSession, SessionData } from '../lib/auth/app-session.js'

export type { AppSession, SessionData }

declare module 'fastify' {
  interface FastifyRequest {
    session: AppSession
  }
}

export {}
