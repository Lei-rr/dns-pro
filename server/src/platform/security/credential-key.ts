import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const KEY_FILE = 'credential.key'
const KEY_BYTES = 32

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

async function readKey(keyPath: string): Promise<Buffer | null> {
  try {
    await fs.chmod(keyPath, 0o600)
    const raw = (await fs.readFile(keyPath, 'utf8')).trim()
    if (raw === '') return null
    const key = Buffer.from(raw, 'base64url')
    return key.length === KEY_BYTES ? key : null
  } catch (error) {
    if (isCode(error, 'ENOENT')) return null
    throw error
  }
}

/** 加载或原子创建凭据加密密钥（32 字节，仅属主可读）；首次调用生成并落盘 */
export async function loadCredentialKey(dataDir: string): Promise<Buffer> {
  const keyPath = path.join(dataDir, KEY_FILE)
  const existing = await readKey(keyPath)
  if (existing !== null) return existing

  await fs.mkdir(dataDir, { recursive: true })
  const generated = crypto.randomBytes(KEY_BYTES)
  const temporary = path.join(dataDir, `${KEY_FILE}.${process.pid}.${crypto.randomUUID()}.tmp`)
  await fs.writeFile(temporary, `${generated.toString('base64url')}\n`, { mode: 0o600 })
  try {
    await fs.link(temporary, keyPath)
    await fs.chmod(keyPath, 0o600)
    return generated
  } catch (error) {
    if (!isCode(error, 'EEXIST')) throw error
    const winner = await readKey(keyPath)
    if (winner !== null) return winner
    throw Object.assign(new Error('Persisted credential key is invalid'), { cause: error })
  } finally {
    await fs.rm(temporary, { force: true })
  }
}
