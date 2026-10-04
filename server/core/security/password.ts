import crypto from 'node:crypto'

// scrypt 参数：N=16384（约 16MB 内存）、r=8、p=1，单次约数十毫秒，登录接口已限流
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const
const SALT_BYTES = 16
const PREFIX = 'scrypt'

/** 生成随机初始密码（去除易混淆字符，便于人工抄写） */
export function generatePassword(length = 16): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  // 逐字符走 randomInt（拒绝采样）：字节取模会在字母表前段造成可见的概率偏置
  let password = ''
  for (let index = 0; index < length; index++) password += alphabet.charAt(crypto.randomInt(alphabet.length))
  return password
}

/** 生成自描述哈希：scrypt$N$r$p$salt$hash（参数变更后可平滑升级） */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_BYTES)
  const derived = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p })
  return [PREFIX, SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), derived.toString('base64')].join('$')
}

/** 校验密码；哈希格式非法时返回 false 而不是抛错 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== PREFIX) return false
  const [, n, r, p, saltPart, hashPart] = parts as [string, string, string, string, string, string]
  const params = { N: Number(n), r: Number(r), p: Number(p) }
  if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) return false
  try {
    const expected = Buffer.from(hashPart, 'base64')
    const derived = crypto.scryptSync(password, Buffer.from(saltPart, 'base64'), expected.length, params)
    return crypto.timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

/** 常量时间比较（用于用户名等短字符串） */
export function safeEqual(a: string, b: string): boolean {
  const digest = (value: string) => crypto.createHash('sha256').update(value).digest()
  return crypto.timingSafeEqual(digest(a), digest(b))
}
