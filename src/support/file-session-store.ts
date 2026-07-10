import fs from 'node:fs/promises'
import path from 'node:path'
import type fastifySession from '@fastify/session'
import type { FastifyRequest } from 'fastify'

const SESSION_DIR = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'data'), 'sessions')

type SessionData = FastifyRequest['session'] & Record<string, unknown>

type Callback = (err?: Error | null) => void
type CallbackSession = (err: Error | null, result?: SessionData | null) => void

export class FileSessionStore implements fastifySession.SessionStore {
  constructor() {
    void fs.mkdir(SESSION_DIR, { recursive: true })
  }

  get(sessionId: string, callback: CallbackSession): void {
    void (async () => {
      try {
        const filePath = this.getFilePath(sessionId)
        const content = await fs.readFile(filePath, 'utf-8')
        const data = JSON.parse(content) as SessionData
        const expires = data.expires
        if (expires && new Date(String(expires)).getTime() < Date.now()) {
          await fs.unlink(filePath).catch(() => {})
          callback(null, null)
          return
        }
        callback(null, data)
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          callback(null, null)
          return
        }
        callback(error instanceof Error ? error : new Error(String(error)), null)
      }
    })()
  }

  set(sessionId: string, session: SessionData, callback: Callback): void {
    void (async () => {
      try {
        await fs.mkdir(SESSION_DIR, { recursive: true })
        const filePath = this.getFilePath(sessionId)
        await fs.writeFile(filePath, JSON.stringify(session), 'utf-8')
        callback(null)
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)))
      }
    })()
  }

  destroy(sessionId: string, callback: Callback): void {
    void (async () => {
      try {
        await fs.unlink(this.getFilePath(sessionId))
        callback(null)
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          callback(null)
          return
        }
        callback(error instanceof Error ? error : new Error(String(error)))
      }
    })()
  }

  private getFilePath(sessionId: string): string {
    return path.join(SESSION_DIR, `${sessionId}.json`)
  }
}
