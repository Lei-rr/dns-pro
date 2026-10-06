import crypto from 'node:crypto'

/** 会话载荷：用户名 + 过期时间 + 版本指纹（凭据/会话代次变化即失效） */
interface SessionClaims {
  username: string
  expiresAt: number
  version: string
}

const KEY_INFO = 'dns-pro/session/v2'
const TOKEN_VERSION = 'v2'

/** 由主密钥派生专用加密密钥（HKDF-SHA256） */
export function deriveSessionKey(secret: string): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', secret, 'dns-pro', KEY_INFO, 32))
}

/** AES-256-GCM 加密会话，返回 `v2.iv.tag.data` */
export function sealSession(claims: SessionClaims, key: Buffer): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(TOKEN_VERSION))
  const payload = JSON.stringify({ u: claims.username, e: claims.expiresAt, v: claims.version })
  const data = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()])
  return [TOKEN_VERSION, iv, cipher.getAuthTag(), data]
    .map((part) => (Buffer.isBuffer(part) ? part.toString('base64url') : part))
    .join('.')
}

/** 解密并校验格式与过期时间；任何异常返回 null */
export function openSession(token: string | undefined, key: Buffer, now = Date.now()): SessionClaims | null {
  if (!token || token.length > 4096) return null
  const [version, iv, tag, data, ...rest] = token.split('.')
  if (version !== TOKEN_VERSION || !iv || !tag || !data || rest.length > 0) return null
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
    decipher.setAAD(Buffer.from(TOKEN_VERSION))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    const plain = Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
    const parsed = JSON.parse(plain) as { u?: unknown; e?: unknown; v?: unknown }
    if (typeof parsed.u !== 'string' || typeof parsed.e !== 'number' || typeof parsed.v !== 'string') return null
    if (parsed.e <= now) return null
    return { username: parsed.u, expiresAt: parsed.e, version: parsed.v }
  } catch {
    return null
  }
}

/** 会话版本指纹：绑定用户名、凭据材料（哈希/明文）与会话代次；改密码或登出后旧会话全部失效 */
export function sessionVersion(
  key: Buffer,
  credentials: { username: string; credential: string },
  epoch: number
): string {
  return crypto
    .createHmac('sha256', key)
    .update(`${credentials.username}\0${credentials.credential}\0${epoch}`)
    .digest('base64url')
}
