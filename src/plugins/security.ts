import crypto from 'node:crypto'
import type { FastifyInstance, FastifyReply } from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fastifySecureSession from '@fastify/secure-session'
import fastifyHelmet from '@fastify/helmet'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifySensible from '@fastify/sensible'
import type { AppConfig } from '../config/app.js'
import { error } from '../lib/http/api-response.js'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, must-revalidate',
  Pragma: 'no-cache',
}

export function securityPlugin(app: FastifyInstance, config: AppConfig) {
  app.register(fastifyHelmet, {
    contentSecurityPolicy: false,
  })

  app.addHook('onSend', async (_request, reply: FastifyReply, _payload) => {
    if (_request.url.startsWith('/api/')) {
      void reply.headers(NO_STORE_HEADERS)
    }
  })

  app.register(fastifyCookie)
  app.register(fastifySecureSession, {
    cookieName: config.sessionCookieName,
    key: crypto.createHash('sha256').update(config.sessionSecret).digest(),
    cookie: {
      secure: config.cookieSecure,
      httpOnly: true,
      sameSite: config.cookieSameSite,
      maxAge: config.sessionMaxAgeSeconds,
    },
  })

  app.register(fastifyRateLimit, {
    global: true,
    max: config.rateLimitGlobalMax,
    timeWindow: config.rateLimitTimeWindow,
    hook: 'preHandler',
    keyGenerator: (request) => request.ip,
    allowList: (request) => !request.url.startsWith('/api/'),
    errorResponseBuilder: () => error('请求过于频繁，请稍后再试', 429, 'rate_limited'),
  })

  app.register(fastifySensible)
}
