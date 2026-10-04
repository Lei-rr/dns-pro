import crypto from 'node:crypto'
import Fastify from 'fastify'
import { TypeBoxValidatorCompiler, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { AppConfig } from './bootstrap/app-config.js'
import { createAppContext, startAppContext } from './bootstrap/create-context.js'
import { registerApiRoutes } from './bootstrap/register-routes.js'
import { appContextPlugin } from './plugins/app-context.js'
import { errorHandlerPlugin } from './plugins/error-handler.js'
import { securityPlugin } from './plugins/security.js'
import { staticPlugin } from './plugins/static.js'

// 上游传入的请求 ID 仅接受安全字符，防止日志注入
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

/**
 * HTTP 外壳：plugins（Fastify 插件）→ modules（领域能力）→ workflows（跨模块用例）→ platform/shared。
 */
export async function buildApp(config: AppConfig) {
  if (config.sessionSecret.trim().length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters')
  }

  const app = Fastify({
    logger: config.logLevel
      ? {
          level: config.logLevel,
          // 日志脱敏：Cookie、鉴权头、凭据字段
          redact: {
            paths: [
              'req.headers.cookie',
              'req.headers.authorization',
              'res.headers["set-cookie"]',
              '*.password',
              '*.secret_key',
              '*.api_token',
              'err.details.upstream_body',
            ],
            censor: '[REDACTED]',
          },
        }
      : false,
    // 数字表示信任最近 N 跳代理
    trustProxy:
      typeof config.trustProxy === 'number'
        ? (_address: string, hop: number) => hop < (config.trustProxy as number)
        : config.trustProxy,
    // 关闭内置头解析：否则 fastify 会直接采用 X-Request-Id 原值并跳过 genReqId
    requestIdHeader: false,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id']
      return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID()
    },
    // 路径参数上限需覆盖最长域名（schema 允许 253），默认 100 会让合法域名直接 414
    routerOptions: { maxParamLength: 256 },
    bodyLimit: 1024 * 1024,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  })
    .withTypeProvider<TypeBoxTypeProvider>()
    .setValidatorCompiler(TypeBoxValidatorCompiler)

  const ctx = await createAppContext(config)
  await startAppContext(ctx, app.log)

  await app.register(appContextPlugin, { ctx })
  app.addHook('onClose', async () => {
    await ctx.platform.jobs.close()
  })
  await app.register(securityPlugin)
  await app.register(staticPlugin)
  await app.register(errorHandlerPlugin)
  // 个人面板，不做 API 版本前缀
  await app.register(registerApiRoutes, { prefix: '/api' })

  return app
}
