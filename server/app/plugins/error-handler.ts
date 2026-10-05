import type { FastifyError, FastifyPluginAsync, FastifySchemaValidationError } from 'fastify'
import fp from 'fastify-plugin'
import { ApiError } from '../../core/http/api-error.js'
import { error } from '../../core/http/api-response.js'
import { translateError } from '../../core/http/error-messages.js'

/** 5xx 未登记中文文案时的兜底文案：绝不透出原始 message（可能含文件路径、上游响应、底层库报错文本） */
const GENERIC_SERVER_ERROR_MESSAGE = '服务暂时不可用，请稍后重试'

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

function toFieldNames(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value]
  return list.map((entry) => String(entry ?? '').trim()).filter(Boolean)
}

function validationFieldErrors(validation: FastifySchemaValidationError[]): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const item of validation) {
    const message = item.message || '字段格式不正确'
    // TypeBox 编译器的必填 / 多余字段错误 instancePath 为空，字段名只出现在 params 数组里；
    // Ajv 形状则是单数字段名，两种都收，否则前端拿不到可定位表单的键
    const names = [
      ...toFieldNames(item.params?.requiredProperties),
      ...toFieldNames(item.params?.additionalProperties),
      ...toFieldNames(item.params?.missingProperty),
      ...toFieldNames(item.params?.additionalProperty),
    ]
    if (names.length) {
      for (const name of names) fields[name] ??= message
      continue
    }
    const path = String(item.instancePath ?? '')
      .split('/')
      .filter(Boolean)
      .at(-1)
    fields[path || 'request'] ??= message
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
      // 5xx 一律不透出原始 message：优先用错误码已登记的中文文案，未登记则用通用文案。
      // 只按 code 走白名单式文案（文案由本仓库维护），新增 5xx 错误码默认就是安全的
      const message = status >= 500 ? (translateError(err.code) ?? GENERIC_SERVER_ERROR_MESSAGE) : err.message
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
