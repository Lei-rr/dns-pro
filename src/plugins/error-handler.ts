import type { FastifyError, FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { ApiError } from '../lib/http/api-error.js'
import { error } from '../lib/http/api-response.js'

const errorHandlerPluginImpl: FastifyPluginAsync = async (app) => {
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.status(404).send(error('not_found', 404, 'not_found'))
    }
    return reply.sendFile('index.html')
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
})
