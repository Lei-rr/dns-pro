import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyError, type FastifyReply } from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyCompress from '@fastify/compress'
import fastifyCookie from '@fastify/cookie'
import fastifySecureSession from '@fastify/secure-session'
import fastifyHelmet from '@fastify/helmet'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifySensible from '@fastify/sensible'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import type { AppConfig } from './config/app.js'
import { ApiError } from './support/api-error.js'
import { error } from './support/api-response.js'
import { systemRoutes } from './routes/system.js'
import { authRoutes } from './routes/auth.js'
import { protectedRoutes } from './routes/protected.js'
import './types/session.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, '../web/dist')

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, must-revalidate',
  Pragma: 'no-cache',
}

export function buildApp(config: AppConfig) {
  const app = Fastify({
    logger: config.logLevel ? { level: config.logLevel } : false,
  })

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

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

  app.register(fastifyCompress)
  app.register(fastifyStatic, {
    root: distDir,
    prefix: '/',
    wildcard: false,
    maxAge: '1y',
    immutable: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store, must-revalidate')
      }
    },
  })

  app.register(systemRoutes, { prefix: '/api' })
  app.register(authRoutes, { prefix: '/api' })
  app.register(protectedRoutes, { prefix: '/api' })

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.status(404).send(error('API endpoint not found', 404, 'not_found'))
    }
    return reply.sendFile('index.html')
  })

  app.setErrorHandler(async (err: FastifyError, request, reply) => {
    request.log.error(err)

    if (err instanceof ApiError) {
      return reply.status(err.statusCode).send(error(err.message, err.statusCode, err.code, err.details))
    }

    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.status(err.statusCode).send(error(err.message, err.statusCode, 'request_error'))
    }

    if (err.code === 'FST_ERR_VALIDATION' || err.statusCode === 400) {
      return reply.status(400).send(error(err.message, 400, 'validation_error'))
    }

    return reply.status(500).send(error('Internal server error', 500, 'internal_error'))
  })

  return app
}
