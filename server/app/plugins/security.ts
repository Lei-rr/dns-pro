import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import fastifyCookie from '@fastify/cookie'
import fastifyHelmet from '@fastify/helmet'
import fastifyRateLimit from '@fastify/rate-limit'
import { ApiError } from '../../core/http/api-error.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF 防护：写操作必须同源。
 * 浏览器总会对跨站请求带 Origin / Sec-Fetch-Site；脚本客户端（无这两个头）不受影响，
 * 其凭据本就只能来自 Cookie，无法被第三方页面借用。
 */
function assertSameOrigin(request: FastifyRequest): void {
  if (SAFE_METHODS.has(request.method)) return
  const fetchSite = request.headers['sec-fetch-site']
  if (fetchSite === 'cross-site' || fetchSite === 'same-site') {
    throw new ApiError('csrf_rejected', 'Cross-site request rejected', 403)
  }
  const origin = request.headers.origin
  if (!origin) return
  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    throw new ApiError('csrf_rejected', 'Invalid Origin header', 403)
  }
  if (originHost !== request.host) throw new ApiError('csrf_rejected', 'Cross-origin request rejected', 403)
}

/** 安全插件：限流 / 安全响应头 / Cookie / CSRF / API 禁缓存 */
const securityPluginImpl: FastifyPluginAsync = async (app) => {
  await app.register(fastifyRateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) => {
      const secondsLeft = Math.ceil(context.ttl / 1000)
      return {
        statusCode: 429,
        code: 'auth_rate_limited',
        message: `登录尝试过于频繁，已临时锁定，请 ${Math.ceil(secondsLeft / 60)} 分钟后再试`,
        details: { retry_after: secondsLeft },
      }
    },
  })

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
    // 允许跨站嵌入的资源头保持默认 same-origin
    crossOriginResourcePolicy: { policy: 'same-origin' },
  })

  await app.register(fastifyCookie)

  app.addHook('onRequest', async (request) => {
    if (request.url.startsWith('/api/')) assertSameOrigin(request)
  })
  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache')
  })
}

export const securityPlugin = fp(securityPluginImpl, { name: 'security', fastify: '5.x' })
