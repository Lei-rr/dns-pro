import type { FastifyError, FastifyPluginAsync, FastifySchemaValidationError } from 'fastify'
import fp from 'fastify-plugin'
import { ApiError } from '../shared/http/api-error.js'
import { error } from '../shared/http/api-response.js'

/** 对外暴露的 details 字段白名单；上游原始响应、文件路径等只写日志 */
const PUBLIC_DETAIL_KEYS = new Set([
  'errors',
  'dependencies',
  'job_id',
  'retry_after',
  'provider_id',
  'expected_type',
  'actual_type',
  'chain',
  'hostname',
  'sync_zone',
  'code',
  'upstream_status',
])

function publicDetails(details: unknown): Record<string, unknown> | undefined {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined
  const picked = Object.entries(details).filter(([key]) => PUBLIC_DETAIL_KEYS.has(key))
  return picked.length ? Object.fromEntries(picked) : undefined
}

function validationFieldErrors(validation: FastifySchemaValidationError[]): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const item of validation) {
    const field =
      String(item.params?.missingProperty ?? '').trim() ||
      String(item.params?.additionalProperty ?? '').trim() ||
      String(item.instancePath ?? '')
        .split('/')
        .filter(Boolean)
        .at(-1) ||
      'request'
    fields[field] ??= item.message || '字段格式不正确'
  }
  return fields
}

const isPath = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`)

/** 全局 404 与错误处理；依赖 static 插件以便 SPA 回退 */
const errorHandlerPluginImpl: FastifyPluginAsync = async (app) => {
  app.setNotFoundHandler(async (request, reply) => {
    const pathname = new URL(request.url, 'http://local').pathname
    const acceptsHtml = String(request.headers.accept ?? '')
      .toLowerCase()
      .split(',')
      .some((value) => value.trim().startsWith('text/html'))
    const spaNavigation =
      (request.method === 'GET' || request.method === 'HEAD') &&
      acceptsHtml &&
      !isPath(pathname, '/api') &&
      !isPath(pathname, '/assets')

    if (spaNavigation && typeof reply.sendFile === 'function') {
      try {
        return await reply.sendFile('index.html')
      } catch {
        // 前端未构建时回落到 JSON 404
      }
    }
    return reply
      .status(404)
      .header('Cache-Control', 'no-store')
      .send(error('not_found', 404, 'not_found'))
  })

  app.setErrorHandler(async (err: FastifyError, request, reply) => {
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500
    if (status >= 500) request.log.error(err)
    else request.log.warn(err)

    if (err instanceof ApiError) {
      // 5xx 的内部细节（文件路径、上游响应）不返回给客户端
      const message = status >= 500 && err.code === 'server_error' ? 'server_error' : err.message
      return reply.status(status).send(error(message, status, err.code, publicDetails(err.details)))
    }
    if (err.code === 'FST_ERR_VALIDATION') {
      return reply
        .status(400)
        .send(error('参数校验未通过', 400, 'validation_error', { errors: validationFieldErrors(err.validation ?? []) }))
    }
    if (status === 429) {
      const limited = err as unknown as { code?: string; message?: string; details?: unknown }
      return reply
        .status(429)
        .send(
          error(limited.message || '请求过于频繁，请稍后重试', 429, 'auth_rate_limited', publicDetails(limited.details))
        )
    }
    if (status < 500) return reply.status(status).send(error(err.message, status, 'request_error'))
    return reply.status(500).send(error('internal_error', 500, 'internal_error'))
  })
}

export const errorHandlerPlugin = fp(errorHandlerPluginImpl, {
  name: 'error-handler',
  fastify: '5.x',
  dependencies: ['static'],
})
