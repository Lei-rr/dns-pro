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
    contentSecurityPolicy: false,
  })

  app.addHook('onSend', async (_request, reply: FastifyReply, _payload) => {
    if (_request.url.startsWith('/api/')) {
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

/** Breaks encapsulation so session/cookie decorations are available on the root app. */
export const securityPlugin = fp(securityPluginImpl, {
  name: 'security',
  fastify: '5.x',
})

declare module 'fastify' {
  interface FastifyRequest {
    session: AppSession
  }
}
