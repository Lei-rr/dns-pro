import type { FastifyError, FastifyPluginAsync, FastifySchemaValidationError } from 'fastify'
import fp from 'fastify-plugin'
import { ApiError } from '../lib/http/api-error.js'
import { error } from '../lib/http/api-response.js'

function validationFieldErrors(validation: FastifySchemaValidationError[]): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const item of validation) {
    const missing = String(item.params?.missingProperty ?? '').trim()
    const additional = String(item.params?.additionalProperty ?? '').trim()
    const path = String(item.instancePath ?? '').split('/').filter(Boolean).at(-1) ?? ''
    const field = missing || additional || path || 'request'
    if (!(field in fields)) fields[field] = item.message || '字段格式不正确'
  }
  return fields
}

/**
 * Global not-found + error handlers.
 * Depends on `static` so reply.sendFile works for SPA fallback when web/dist exists.
 */
const errorHandlerPluginImpl: FastifyPluginAsync = async (app) => {
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.status(404).send(error('not_found', 404, 'not_found'))
    }

    if (request.url.startsWith('/assets/')) {
      return reply
        .status(404)
        .header('Cache-Control', 'no-store')
        .send(error('not_found', 404, 'not_found'))
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

    if (err.code === 'FST_ERR_VALIDATION') {
      const errors = validationFieldErrors(err.validation ?? [])
      return reply.status(400).send(error('参数校验未通过', 400, 'validation_error', { errors }))
    }

    if (err.statusCode === 400) {
      return reply.status(400).send(error(err.message, 400, 'request_error'))
    }

    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.status(err.statusCode).send(error(err.message, err.statusCode, 'request_error'))
    }

    return reply.status(500).send(error('internal_error', 500, 'internal_error'))
  })
}

export const errorHandlerPlugin = fp(errorHandlerPluginImpl, {
  name: 'error-handler',
  fastify: '5.x',
  dependencies: ['static'],
})
