import fs from 'node:fs/promises'
import path from 'node:path'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { success, error } from '../../shared/http/api-response.js'
import { noRequestSchema, type RequestOf } from '../../shared/http/request-schema.js'
import { getDataRoot } from '../../platform/storage/json-store.js'
import { providerCacheStats } from '../../platform/cache/provider-cache.js'

async function isDirectoryWritable(dir: string): Promise<boolean> {
  const probe = path.join(dir, `.health-check-${Date.now()}`)
  try {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(probe, '', 'utf-8')
    await fs.unlink(probe)
    return true
  } catch {
    return false
  }
}

async function isFileReadable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.R_OK)
    return true
  } catch {
    return false
  }
}

import { APP_VERSION } from '../../shared/version.js'

export async function getHealthHandler(
  request: FastifyRequest<RequestOf<typeof noRequestSchema>>,
  reply: FastifyReply
) {
  const dataRoot = getDataRoot()
  const [writable, configReadable, jobs] = await Promise.all([
    isDirectoryWritable(dataRoot),
    isFileReadable(path.resolve(dataRoot, 'config.json')),
    request.server.ctx.platform.jobs.stats().catch(() => ({ total: 0, active: 0, finished: 0 })),
  ])

  const payload = {
    status: 'ok',
    version: APP_VERSION,
    data_dir: { writable, config_readable: configReadable },
    cache: providerCacheStats(),
    jobs,
  }

  if (!writable) {
    return reply.status(503).send(error('health_check_failed', 503, 'health_check_failed', payload))
  }

  return reply.send(success(payload))
}
