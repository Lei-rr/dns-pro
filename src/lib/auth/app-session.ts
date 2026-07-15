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

/** Collect every value for a cookie name. Browsers may send duplicates after session format changes. */
export function readCookieValues(request: FastifyRequest, name: string): string[] {
  const values: string[] = []
  const raw = request.headers.cookie
  if (typeof raw === 'string' && raw.length > 0) {
    for (const part of raw.split(';')) {
      const idx = part.indexOf('=')
      if (idx === -1) continue
      const key = part.slice(0, idx).trim()
      if (key !== name) continue
      const rawValue = part.slice(idx + 1).trim()
      try {
        values.push(decodeURIComponent(rawValue))
      } catch {
        values.push(rawValue)
      }
    }
  }

  if (values.length === 0) {
    const single = request.cookies?.[name]
    if (typeof single === 'string' && single) values.push(single)
    else if (Array.isArray(single)) {
      for (const item of single) {
        if (typeof item === 'string' && item) values.push(item)
      }
    }
  }

  return values
}

export function resolveSessionData(request: FastifyRequest, options: SessionOptions): SessionData {
  const tokens = readCookieValues(request, options.cookieName)
  // Prefer the last valid token (usually the newest Set-Cookie after login).
  for (let i = tokens.length - 1; i >= 0; i--) {
    const data = unsealSession(tokens[i], options.secret)
    if (data && data['auth.signed_in'] === true) return data
  }
  for (let i = tokens.length - 1; i >= 0; i--) {
    const data = unsealSession(tokens[i], options.secret)
    if (data) return data
  }
  return {}
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
  const current = resolveSessionData(request, options)
  const session = createAppSession(current)
  ;(request as FastifyRequest & { session: AppSession }).session = session
  return session
}

function cookieBaseOptions(options: SessionOptions) {
  return {
    path: '/',
    secure: options.secure,
    httpOnly: true,
    sameSite: options.sameSite,
  } as const
}

export function writeAppSessionCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  options: SessionOptions,
) {
  const session = (request as FastifyRequest & { session?: AppSession }).session
  if (!session || (!session.dirty && !session.deleted)) return

  const base = cookieBaseOptions(options)

  if (session.deleted || !session.get('auth.signed_in')) {
    reply.clearCookie(options.cookieName, base)
    return
  }

  const token = sealSession(session.toJSON(), options.secret, options.maxAgeSeconds)
  // Overwrite any stale duplicate cookie for the same name/path.
  reply.clearCookie(options.cookieName, base)
  reply.setCookie(options.cookieName, token, {
    ...base,
    maxAge: options.maxAgeSeconds,
  })
}
