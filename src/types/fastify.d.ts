/**
 * Shared Fastify type augmentations (foundation).
 * Keep small — domain types stay in modules.
 */
import type { AppSession } from '../lib/auth/app-session.js'

declare module 'fastify' {
  interface FastifyRequest {
    session: AppSession
    /** Set by dnspod/cloudflare route scopes for shared DNS batch handlers */
    dnsProviderType?: string
  }
}

export {}
