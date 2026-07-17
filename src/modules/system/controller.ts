import fs from 'node:fs/promises'
import path from 'node:path'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { success, error } from '../../lib/http/api-response.js'
import { getDataRoot } from '../../lib/storage/json-store.js'
import { globalCache } from '../../lib/cache/provider-cache.js'
import { auditService } from '../../lib/utils/audit.js'
import { backupService } from '../../lib/utils/backup.js'
import { queryInt, queryRecord, bodyRecord } from '../../lib/utils/request-parse.js'

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

export async function healthShow(request: FastifyRequest, reply: FastifyReply) {
  const dataRoot = getDataRoot()
  const [writable, configReadable, jobs] = await Promise.all([
    isDirectoryWritable(dataRoot),
    isFileReadable(path.resolve(dataRoot, 'config.json')),
    request.server.ctx.jobService.stats().catch(() => ({ total: 0, active: 0, finished: 0 })),
  ])

  const payload = {
    status: 'ok',
    data_dir: { path: dataRoot, writable, config_readable: configReadable },
    cache: globalCache.stats(),
    jobs,
  }

  if (!writable) {
    return reply.status(503).send(error('health_check_failed', 503, 'health_check_failed', payload))
  }

  return reply.send(success(payload))
}

export async function auditIndex(request: FastifyRequest, reply: FastifyReply) {
  const q = queryRecord(request)
  const items = await auditService.list(queryInt(q, 'limit', 100, 1, 1000))
  return reply.send(success({ items }))
}

export async function backupsIndex(_request: FastifyRequest, reply: FastifyReply) {
  const items = await backupService.list()
  return reply.send(success({ items }))
}

export async function backupsStore(_request: FastifyRequest, reply: FastifyReply) {
  const result = await backupService.create()
  await auditService.write({
    ts: Date.now(),
    action: 'system.backup.create',
    result: 'success',
    meta: result,
  })
  return reply.status(201).send(success(result))
}

export async function backupsRestore(request: FastifyRequest, reply: FastifyReply) {
  const body = bodyRecord(request)
  const id = String(body.id ?? '').trim()
  const result = await backupService.restore(id)
  await auditService.write({
    ts: Date.now(),
    action: 'system.backup.restore',
    result: 'success',
    meta: result,
  })
  return reply.send(success(result))
}
