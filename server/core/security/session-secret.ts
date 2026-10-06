import crypto from 'node:crypto'
import path from 'node:path'
import { loadOrCreateSecretFile } from './secret-file.js'

const SECRET_FILE = 'session-secret'
/** 会话密钥最小长度：持久化文件与显式配置共用同一门槛（启动校验见 app/lifecycle.ts） */
export const SECRET_MIN_LENGTH = 32
const SECRET_BYTES = 48

/** Resolve the session key from env, otherwise persist one random key per data directory. */
export async function resolveSessionSecret(dataDir: string, configuredSecret: string): Promise<string> {
  const explicit = configuredSecret.trim()
  if (explicit !== '') return explicit

  return loadOrCreateSecretFile({
    filePath: path.join(dataDir, SECRET_FILE),
    parse: (raw) => (raw.length >= SECRET_MIN_LENGTH ? raw : null),
    generate: () => {
      const secret = crypto.randomBytes(SECRET_BYTES).toString('base64url')
      return { content: `${secret}\n`, value: secret }
    },
    invalidMessage: 'Persisted session secret is invalid',
  })
}
