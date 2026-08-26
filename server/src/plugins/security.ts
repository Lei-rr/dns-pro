import type { FastifyReply, FastifyPluginAsync, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import fastifyCookie from '@fastify/cookie'
import fastifyHelmet from '@fastify/helmet'
import fastifyRateLimit from '@fastify/rate-limit'
import type { AppConfig } from '../bootstrap/app-config.js'
import { attachAppSession, writeAppSessionCookie, type AppSession } from '../shared/auth/app-session.js'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, must-revalidate',
  Pragma: 'no-cache',
}

export type SecurityPluginOptions = {
  config: AppConfig
}

/**
 * Official security stack:
 * - @fastify/rate-limit (standard Fastify rate limiter)
 * - @fastify/helmet
 * - @fastify/cookie
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

  await app.register(fastifyRateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) => {
      const secondsLeft = Math.ceil(context.ttl / 1000)
      const minutesLeft = Math.ceil(secondsLeft / 60)
      return {
        statusCode: 429,
        code: 'auth_rate_limited',
        message: `登录请求过于频繁，已被锁定15分钟，请 ${minutesLeft} 分钟后再试（剩余 ${secondsLeft} 秒）`,
        status: 429,
        details: {
          retry_after: secondsLeft,
          ttl: context.ttl,
        },
      }
    },
  })

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
}

export const securityPlugin = fp(securityPluginImpl, {
  name: 'security',
  fastify: '5.x',
})
