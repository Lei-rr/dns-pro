import * as crypto from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import '@fastify/cookie'

export type SessionData = {
  'auth.signed_in'?: boolean
  'auth.username'?: string | null
}

export type AppSession = {
  get<K extends keyof SessionData>(key: K): SessionData[K]
  set<K extends keyof SessionData>(key: K, value: SessionData[K]): void
  delete(): void
  readonly dirty: boolean
  readonly deleted: boolean
  toJSON(): SessionData
}

type SessionOptions = {
  secret: string
  cookieName: string
  maxAgeSeconds: number
  secure: boolean
  sameSite: 'lax' | 'strict' | 'none'
}

function keyFromSecret(secret: string) {
  return crypto.createHash('sha256').update(secret).digest()
}

function b64url(buf: Buffer) {
  return buf.toString('base64url')
}

function fromB64url(value: string) {
  return Buffer.from(value, 'base64url')
}

export function sealSession(data: SessionData, secret: string, maxAgeSeconds: number): string {
  const key = keyFromSecret(secret)
  const iv = crypto.randomBytes(12)
  const payload = Buffer.from(
    JSON.stringify({
      ...data,
      exp: Math.floor(Date.now() / 1000) + maxAgeSeconds,
    }),
    'utf8',
  )
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${b64url(iv)}.${b64url(tag)}.${b64url(encrypted)}`
}

export function unsealSession(token: string | undefined, secret: string): SessionData | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const [ivPart, tagPart, dataPart] = parts
    const key = keyFromSecret(secret)
    const iv = fromB64url(ivPart)
    const tag = fromB64url(tagPart)
    const encrypted = fromB64url(dataPart)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
    const parsed = JSON.parse(plain) as SessionData & { exp?: number }
    if (typeof parsed.exp === 'number' && parsed.exp < Math.floor(Date.now() / 1000)) {
      return null
    }
    const { exp: _exp, ...data } = parsed
    return data
  } catch {
    return null
  }
}

export function createAppSession(initial: SessionData = {}): AppSession {
  const data: SessionData = { ...initial }
  let dirty = false
  let deleted = false

  return {
    get(key) {
      return data[key]
    },
    set(key, value) {
      data[key] = value
      dirty = true
      deleted = false
    },
    delete() {
      for (const key of Object.keys(data) as Array<keyof SessionData>) {
        delete data[key]
      }
      dirty = true
      deleted = true
    },
    get dirty() {
      return dirty
    },
    get deleted() {
      return deleted
    },
    toJSON() {
      return { ...data }
    },
  }
}

export function attachAppSession(request: FastifyRequest, options: SessionOptions) {
  const current = unsealSession(request.cookies[options.cookieName], options.secret) || {}
  const session = createAppSession(current)
  ;(request as FastifyRequest & { session: AppSession }).session = session
  return session
}

export function writeAppSessionCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  options: SessionOptions,
) {
  const session = (request as FastifyRequest & { session?: AppSession }).session
  if (!session || (!session.dirty && !session.deleted)) return

  if (session.deleted || !session.get('auth.signed_in')) {
    reply.clearCookie(options.cookieName, {
      path: '/',
      secure: options.secure,
      httpOnly: true,
      sameSite: options.sameSite,
    })
    return
  }

  const token = sealSession(session.toJSON(), options.secret, options.maxAgeSeconds)
  reply.setCookie(options.cookieName, token, {
    path: '/',
    secure: options.secure,
    httpOnly: true,
    sameSite: options.sameSite,
    maxAge: options.maxAgeSeconds,
  })
}
