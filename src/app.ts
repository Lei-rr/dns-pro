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
import { providerRoutes } from './routes/provider.js'
import { cloudflareRoutes } from './routes/cloudflare.js'
import { dnspodRoutes } from './routes/dnspod.js'
import { saasRoutes } from './routes/saas.js'
import { edgeOneRoutes } from './routes/edgeone.js'
import { cloudflaredRoutes } from './routes/cloudflared.js'
import './types/session.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, '../web/dist')

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, must-revalidate',
  Pragma: 'no-cache',
}

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
    cookieName: 'dns_pro_session',
    key: SESSION_KEY,
    cookie: {
      secure: false,
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  })
  app.register(fastifyRateLimit, {
    max: 10,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (request) => request.ip,
    allowList: (request) => request.method !== 'POST' || request.url !== '/api/session',
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
  app.register(providerRoutes, { prefix: '/api' })
  app.register(cloudflareRoutes, { prefix: '/api' })
  app.register(dnspodRoutes, { prefix: '/api' })
  app.register(saasRoutes, { prefix: '/api' })
  app.register(edgeOneRoutes, { prefix: '/api' })
  app.register(cloudflaredRoutes, { prefix: '/api' })

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
