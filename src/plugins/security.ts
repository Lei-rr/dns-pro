import crypto from 'node:crypto'
import type { FastifyReply, FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import fastifyCookie from '@fastify/cookie'
import fastifySecureSession from '@fastify/secure-session'
import fastifyHelmet from '@fastify/helmet'
import fastifySensible from '@fastify/sensible'
import type { AppConfig } from '../config/app.js'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, must-revalidate',
  Pragma: 'no-cache',
}

export type SecurityPluginOptions = {
  config: AppConfig
}

const securityPluginImpl: FastifyPluginAsync<SecurityPluginOptions> = async (app, opts) => {
  const { config } = opts

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: false,
  })

  app.addHook('onSend', async (_request, reply: FastifyReply, _payload) => {
    if (_request.url.startsWith('/api/')) {
      void reply.headers(NO_STORE_HEADERS)
    }
  })

  await app.register(fastifyCookie)
  await app.register(fastifySecureSession, {
    cookieName: config.sessionCookieName,
    key: crypto.createHash('sha256').update(config.sessionSecret).digest(),
    cookie: {
      secure: config.cookieSecure,
      httpOnly: true,
      sameSite: config.cookieSameSite,
      maxAge: config.sessionMaxAgeSeconds,
    },
  })

  await app.register(fastifySensible)
}

/** Breaks encapsulation so session/cookie decorations are available on the root app. */
export const securityPlugin = fp(securityPluginImpl, {
  name: 'security',
  fastify: '5.x',
})
