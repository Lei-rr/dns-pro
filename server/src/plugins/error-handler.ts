import type { FastifyError, FastifyPluginAsync, FastifySchemaValidationError } from 'fastify'
import fp from 'fastify-plugin'
import { ApiError } from '../shared/http/api-error.js'
import { error } from '../shared/http/api-response.js'

function validationFieldErrors(validation: FastifySchemaValidationError[]): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const item of validation) {
    const missing = String(item.params?.missingProperty ?? '').trim()
    const additional = String(item.params?.additionalProperty ?? '').trim()
    const path =
      String(item.instancePath ?? '')
        .split('/')
        .filter(Boolean)
        .at(-1) ?? ''
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
    const pathname = new URL(request.url, 'http://local').pathname
    const apiPath = pathname === '/api' || pathname.startsWith('/api/')
    const assetPath = pathname === '/assets' || pathname.startsWith('/assets/')
    const jsonNotFound = () =>
      reply
        .status(404)
        .header('Cache-Control', 'no-store')
        .send(error('not_found', 404, 'not_found'))

    if (apiPath || assetPath) return jsonNotFound()

    const acceptsHtml = String(request.headers.accept || '')
      .toLowerCase()
      .split(',')
      .some((value) => value.trim().startsWith('text/html'))
    const spaRequest = (request.method === 'GET' || request.method === 'HEAD') && acceptsHtml
    if (!spaRequest) return jsonNotFound()

    // SPA fallback — only for browser navigation when sendFile is available.
    const sendFile = (reply as { sendFile?: (file: string) => unknown }).sendFile
    if (typeof sendFile === 'function') {
      try {
        return await sendFile.call(reply, 'index.html')
      } catch {
        // fall through
      }
    }
    return jsonNotFound()
  })

  app.setErrorHandler(async (err: FastifyError, request, reply) => {
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      request.log.warn(err)
    } else {
      request.log.error(err)
    }

    if (err instanceof ApiError) {
      return reply.status(err.statusCode).send(error(err.message, err.statusCode, err.code, err.details))
    }

    if (err.statusCode === 429 || (err as unknown as { status?: number }).status === 429) {
      const errObj = err as unknown as { code?: string; message?: string; details?: unknown }
      return reply
        .status(429)
        .send(
          error(errObj.message || '请求过于频繁，请稍后重试', 429, errObj.code || 'auth_rate_limited', errObj.details)
        )
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
