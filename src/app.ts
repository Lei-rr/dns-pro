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
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
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

const SESSION_COOKIE_NAME = 'dns_pro_session'
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
const SESSION_KEY = crypto.createHash('sha256').update('dns-pro-secure-session').digest()

export function buildApp() {
  const logLevel = process.env.LOG_LEVEL
  const app = Fastify({
    logger: logLevel && logLevel !== 'silent' ? { level: logLevel } : false,
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
    cookieName: SESSION_COOKIE_NAME,
    key: SESSION_KEY,
    cookie: {
      secure: false,
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_SECONDS,
    },
  })
  app.register(fastifyRateLimit, {
    global: false,
    timeWindow: '1 minute',
    hook: 'preHandler',
    errorResponseBuilder: () => error('登录过于频繁，请稍后再试', 429, 'rate_limited'),
  })

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

    if (err.code === 'FST_ERR_VALIDATION' || err.statusCode === 400) {
      return reply.status(400).send(error(err.message, 400, 'validation_error'))
    }

    return reply.status(500).send(error('Internal server error', 500, 'internal_error'))
  })

  return app
}
