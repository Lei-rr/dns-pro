import fs from 'node:fs/promises'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { providerCacheStats } from '../../../core/cache/provider-cache.js'
import { error, success } from '../../../core/http/api-response.js'
import type { noRequestSchema, RequestOf } from '../../../core/http/request-schema.js'
import { APP_VERSION } from '../../../core/version.js'

async function isWritable(dir: string): Promise<boolean> {
  try {
    await fs.access(dir, fs.constants.R_OK | fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** 健康检查：匿名只返回状态；登录后附带版本、缓存与任务统计 */
export async function getHealthHandler(
  request: FastifyRequest<RequestOf<typeof noRequestSchema>>,
  reply: FastifyReply
) {
  const { ctx } = request.server
  const writable = await isWritable(ctx.config.dataDir)
  if (!writable) return reply.status(503).send(error('health_check_failed', 503, 'health_check_failed'))

  // 会话判定由装配层注入（platform.session），health 模块不直接引用 auth 模块
  if (!(await ctx.platform.session(request))) return reply.send(success({ status: 'ok' }))

  const jobs = await ctx.platform.jobs.stats().catch(() => null)
  return reply.send(success({ status: 'ok', version: APP_VERSION, cache: providerCacheStats(), jobs }))
}
