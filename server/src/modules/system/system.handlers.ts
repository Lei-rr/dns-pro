import fs from 'node:fs/promises'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { providerCacheStats } from '../../platform/cache/provider-cache.js'
import { getDataRoot } from '../../platform/storage/data-root.js'
import { error, success } from '../../shared/http/api-response.js'
import type { noRequestSchema, RequestOf } from '../../shared/http/request-schema.js'
import { APP_VERSION } from '../../shared/version.js'

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
  const writable = await isWritable(getDataRoot())
  if (!writable) return reply.status(503).send(error('health_check_failed', 503, 'health_check_failed'))

  const { ctx } = request.server
  if (!(await ctx.modules.auth.service.authenticate(request))) return reply.send(success({ status: 'ok' }))

  const jobs = await ctx.platform.jobs.stats().catch(() => null)
  return reply.send(success({ status: 'ok', version: APP_VERSION, cache: providerCacheStats(), jobs }))
}
