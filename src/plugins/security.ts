import type { FastifyReply, FastifyPluginAsync, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import fastifyCookie from '@fastify/cookie'
import fastifyHelmet from '@fastify/helmet'
import fastifySensible from '@fastify/sensible'
import type { AppConfig } from '../config/app.js'
import { attachAppSession, writeAppSessionCookie, type AppSession } from '../lib/auth/app-session.js'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, must-revalidate',
  Pragma: 'no-cache',
}

export type SecurityPluginOptions = {
  config: AppConfig
}

/**
 * Official security stack:
 * - @fastify/helmet
 * - @fastify/cookie
 * - @fastify/sensible
 * + app-session cookie (domain-specific AES-GCM; no sodium/secure-session)
 *
 * fp: session decoration must be root-visible.
 */
const securityPluginImpl: FastifyPluginAsync<SecurityPluginOptions> = async (app, opts) => {
  const { config } = opts
  const sessionOptions = {
    secret: config.sessionSecret,
    cookieName: config.sessionCookieName,
    maxAgeSeconds: config.sessionMaxAgeSeconds,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
  }

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
  })

  app.addHook('onSend', async (request, reply: FastifyReply) => {
    if (request.url.startsWith('/api/')) {
      void reply.headers(NO_STORE_HEADERS)
    }
  })

  await app.register(fastifyCookie)

  app.decorateRequest('session', null as unknown as AppSession)
  app.addHook('onRequest', async (request: FastifyRequest) => {
    attachAppSession(request, sessionOptions)
  })
  app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply) => {
    writeAppSessionCookie(request, reply, sessionOptions)
  })

  await app.register(fastifySensible)
}

export const securityPlugin = fp(securityPluginImpl, {
  name: 'security',
  fastify: '5.x',
})
