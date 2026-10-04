import crypto from 'node:crypto'
import path from 'node:path'
import { loadOrCreateSecretFile } from './secret-file.js'

const KEY_FILE = 'credential.key'
const KEY_BYTES = 32

/** 密钥文件内容必须是长度正确的 base64url 编码 */
function parseKey(raw: string): Buffer | null {
  const key = Buffer.from(raw, 'base64url')
  return key.length === KEY_BYTES ? key : null
}

/** 加载或原子创建凭据加密密钥（32 字节，仅属主可读）；首次调用生成并落盘 */
export function loadCredentialKey(dataDir: string): Promise<Buffer> {
  return loadOrCreateSecretFile({
    filePath: path.join(dataDir, KEY_FILE),
    parse: parseKey,
    generate: () => {
      const key = crypto.randomBytes(KEY_BYTES)
      return { content: `${key.toString('base64url')}\n`, value: key }
    },
    invalidMessage: 'Persisted credential key is invalid',
  })
}
