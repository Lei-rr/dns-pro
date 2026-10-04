import crypto from 'node:crypto'
import { ApiError } from '../http/api-error.js'
import { errorMessage } from '../../shared/values.js'

const PREFIX = 'enc:v1:'
const IV_BYTES = 12

/** 对称加密封装（AES-256-GCM）；带前缀的密文可识别，明文输入原样透传（兼容旧数据） */
export interface SecretBox {
  seal(plaintext: string): string
  open(value: string): string
  isSealed(value: string): boolean
}

export function createSecretBox(key: Buffer): SecretBox {
  return {
    isSealed: (value) => value.startsWith(PREFIX),
    seal(plaintext) {
      const iv = crypto.randomBytes(IV_BYTES)
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      const tag = cipher.getAuthTag().toString('base64url')
      return `${PREFIX}${iv.toString('base64url')}:${ciphertext.toString('base64url')}:${tag}`
    },
    open(value) {
      if (!value.startsWith(PREFIX)) return value
      const [iv, ciphertext, tag] = value.slice(PREFIX.length).split(':')
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
        // 绝不静默降级为密文/空值：密钥丢失或数据损坏必须显式失败
        throw new ApiError(
          'credential_decrypt_failed',
          `Failed to decrypt stored credential: ${errorMessage(error)}`,
          500
        )
      }
    },
  }
}
