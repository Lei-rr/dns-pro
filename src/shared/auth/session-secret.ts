import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const SECRET_FILE = 'session-secret'

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

async function readSecret(secretPath: string): Promise<string | null> {
  try {
    const secret = (await fs.readFile(secretPath, 'utf8')).trim()
    return secret.length >= 32 ? secret : null
  } catch (error) {
    if (isCode(error, 'ENOENT')) return null
    throw error
  }
}

/** Resolve the session key from env, otherwise persist one random key per data directory. */
export async function resolveSessionSecret(dataDir: string, configuredSecret: string): Promise<string> {
  const explicit = configuredSecret.trim()
  if (explicit !== '') return explicit

  const secretPath = path.join(dataDir, SECRET_FILE)
  const existing = await readSecret(secretPath)
  if (existing !== null) return existing

  await fs.mkdir(dataDir, { recursive: true })
  const generated = crypto.randomBytes(48).toString('base64url')

  try {
    await fs.writeFile(secretPath, `${generated}\n`, { flag: 'wx' })
    return generated
  } catch (error) {
    if (!isCode(error, 'EEXIST')) throw error
    const winner = await readSecret(secretPath)
    if (winner !== null) return winner
    throw Object.assign(new Error('Persisted session secret is invalid'), { cause: error })
  }
}
