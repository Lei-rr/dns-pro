import crypto from 'node:crypto'
import { ApiError } from '../http/api-error.js'
import { errorMessage } from '../../shared/values.js'

/** 密文前缀：seal/isSealed 与输入侧校验共用同一字面量，避免两处漂移 */
export const SEALED_VALUE_PREFIX = 'enc:v1:'
const IV_BYTES = 12
/** GCM 认证标签固定 16 字节；无填充 base64url 后为 22 字符 */
const TAG_BASE64URL_LENGTH = 22
/** IV 12 字节 → 无填充 base64url 16 字符 */
const IV_BASE64URL_LENGTH = 16

/**
 * 完整密文形态：enc:v1:<iv(16)>:<ciphertext(≥1)>:<tag(22)>，三段都必须是 base64url 字符。
 * 只判前缀会把「enc:v1: 开头但被截断/恢复错误」的输入当成密文：写入路径跳过加密原样落盘，
 * 之后所有读取路径解密失败（500），而任何写操作前都要先读，界面与接口都无法改回。
 */
const SEALED_VALUE_PATTERN = new RegExp(
  `^${SEALED_VALUE_PREFIX}[A-Za-z0-9_-]{${IV_BASE64URL_LENGTH}}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{${TAG_BASE64URL_LENGTH}}$`
)

/** 对称加密封装（AES-256-GCM）；带前缀的密文可识别，明文输入原样透传（兼容旧数据） */
export interface SecretBox {
  seal(plaintext: string): string
  open(value: string): string
  isSealed(value: string): boolean
}

export function createSecretBox(key: Buffer): SecretBox {
  return {
    isSealed: (value) => SEALED_VALUE_PATTERN.test(value),
    seal(plaintext) {
      const iv = crypto.randomBytes(IV_BYTES)
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      const tag = cipher.getAuthTag().toString('base64url')
      return `${SEALED_VALUE_PREFIX}${iv.toString('base64url')}:${ciphertext.toString('base64url')}:${tag}`
    },
    open(value) {
      if (!value.startsWith(SEALED_VALUE_PREFIX)) return value
      const [iv, ciphertext, tag] = value.slice(SEALED_VALUE_PREFIX.length).split(':')
      if (!iv || !ciphertext || !tag) {
        throw new ApiError('credential_decrypt_failed', 'Stored credential is malformed', 500)
      }
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
        decipher.setAuthTag(Buffer.from(tag, 'base64url'))
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(ciphertext, 'base64url')),
          decipher.final(),
        ]).toString('utf8')
        return plaintext
      } catch (error) {
        // 绝不静默降级为密文/空值：密钥丢失或数据损坏必须显式失败。
        // 底层库报错文本只进 details（对外被 PUBLIC_DETAIL_KEYS 拦下，日志里仍可排查）
        throw new ApiError('credential_decrypt_failed', 'Failed to decrypt stored credential', 500, {
          error: errorMessage(error),
        })
      }
    },
  }
}
