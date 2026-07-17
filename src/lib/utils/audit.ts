import fs from 'node:fs/promises'
import path from 'node:path'
import { getDataRoot } from '../storage/json-store.js'

export type AuditEvent = {
  ts: number
  action: string
  actor?: string
  provider_id?: string
  zone?: string
  hostname?: string
  target?: string
  result?: 'success' | 'failed' | 'skipped'
  message?: string
  meta?: Record<string, unknown>
}

/**
 * Append-only audit log under data/audit.jsonl.
 * Best-effort: failures are swallowed so business flows never break on logging.
 */
export class AuditService {
  private filePath(): string {
    return path.join(getDataRoot(), 'audit.jsonl')
  }

  async write(event: AuditEvent): Promise<void> {
    try {
      const line = JSON.stringify({
        ts: event.ts || Date.now(),
        action: event.action,
        actor: event.actor ?? 'admin',
        provider_id: event.provider_id,
        zone: event.zone,
        hostname: event.hostname,
        target: event.target,
        result: event.result ?? 'success',
        message: event.message,
        meta: event.meta,
      })
      const file = this.filePath()
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.appendFile(file, `${line}\n`, 'utf-8')
    } catch {
      // ignore audit failures
    }
  }

  async list(limit = 100): Promise<AuditEvent[]> {
    try {
      const raw = await fs.readFile(this.filePath(), 'utf-8')
      const lines = raw.split('\n').filter(Boolean)
      const slice = lines.slice(Math.max(0, lines.length - Math.max(1, limit)))
      return slice
        .map((line) => {
          try {
            return JSON.parse(line) as AuditEvent
          } catch {
            return null
          }
        })
        .filter((x): x is AuditEvent => !!x)
        .reverse()
    } catch {
      return []
    }
  }
}

export const auditService = new AuditService()
