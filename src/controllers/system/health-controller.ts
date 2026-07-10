import fs from 'node:fs/promises'
import path from 'node:path'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { success, error } from '../../support/api-response.js'
import { getDataRoot } from '../../support/json-store.js'
import { globalCache } from '../../support/cache-service.js'

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

export async function healthShow(_request: FastifyRequest, reply: FastifyReply) {
  const dataRoot = getDataRoot()
  const [writable, configReadable] = await Promise.all([
    isDirectoryWritable(dataRoot),
    isFileReadable(path.resolve(dataRoot, 'config.json')),
  ])

  const payload = {
    status: 'ok',
    data_dir: { path: dataRoot, writable, config_readable: configReadable },
    cache: globalCache.stats(),
  }

  if (!writable) {
    return reply.status(503).send(error('data directory is not writable', 503, 'health_check_failed', payload))
  }

  return reply.send(success(payload))
}
