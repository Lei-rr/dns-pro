import type { FastifyError, FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { ApiError } from '../lib/http/api-error.js'
import { error } from '../lib/http/api-response.js'

/**
 * Global not-found + error handlers.
 * Depends on `static` so reply.sendFile works for SPA fallback when web/dist exists.
 */
const errorHandlerPluginImpl: FastifyPluginAsync = async (app) => {
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.status(404).send(error('not_found', 404, 'not_found'))
    }

    // SPA fallback — only if sendFile is available (static plugin registered)
    const sendFile = (reply as { sendFile?: (file: string) => unknown }).sendFile
    if (typeof sendFile === 'function') {
      try {
        return await sendFile.call(reply, 'index.html')
      } catch {
        // fall through
      }
    }
    return reply.status(404).type('text/plain').send('Not Found')
  })

  app.setErrorHandler(async (err: FastifyError, request, reply) => {
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      request.log.warn(err)
    } else {
      request.log.error(err)
    }

    if (err instanceof ApiError) {
      return reply.status(err.statusCode).send(error(err.code, err.statusCode, err.code, err.details))
    }

    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.status(err.statusCode).send(error(err.message, err.statusCode, 'request_error'))
    }

    if (err.code === 'FST_ERR_VALIDATION' || err.statusCode === 400) {
      return reply.status(400).send(error(err.message, 400, 'validation_error'))
    }

    return reply.status(500).send(error('internal_error', 500, 'internal_error'))
  })
}

export const errorHandlerPlugin = fp(errorHandlerPluginImpl, {
  name: 'error-handler',
  fastify: '5.x',
  dependencies: ['static'],
})
