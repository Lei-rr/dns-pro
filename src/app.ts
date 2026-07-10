import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyError, type FastifyReply } from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyCompress from '@fastify/compress'
import fastifyCookie from '@fastify/cookie'
import fastifySession from '@fastify/session'
import type { ZodTypeAny } from 'zod'
import { ApiError } from './support/api-error.js'
import { error } from './support/api-response.js'
import { FileSessionStore } from './support/file-session-store.js'
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

export function buildApp() {
  const logLevel = process.env.LOG_LEVEL
  const app = Fastify({
    logger: logLevel && logLevel !== 'silent' ? { level: logLevel } : false,
  })

  app.setValidatorCompiler(({ schema }) => {
    const zodSchema = schema as ZodTypeAny
    return (data: unknown) => {
      const result = zodSchema.safeParse(data)
      if (!result.success) {
        return { error: result.error }
      }
      return { value: result.data }
    }
  })

  app.addHook('onSend', async (_request, reply: FastifyReply, _payload) => {
    void reply.headers(NO_STORE_HEADERS)
  })

  app.register(fastifyCookie)
  app.register(fastifySession, {
    cookieName: 'dns_pro_session',
    secret: process.env.SESSION_SECRET ?? 'dns-pro-default-secret-change-me',
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
    store: new FileSessionStore(),
    saveUninitialized: false,
  })

  app.register(fastifyCompress)
  app.register(fastifyStatic, {
    root: distDir,
    prefix: '/',
    wildcard: false,
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

    if (err.validation) {
      return reply.status(400).send(error(err.message, 400, 'validation_error'))
    }

    return reply.status(500).send(error('Internal server error', 500, 'internal_error'))
  })

  return app
}
