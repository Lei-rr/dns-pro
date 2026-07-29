import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const SECRET_FILE = 'session-secret'

/** Resolve the session key from env, otherwise persist one random key per data directory. */
export async function resolveSessionSecret(dataDir: string, configuredSecret: string): Promise<string> {
  const explicit = configuredSecret.trim()
  if (explicit !== '') return explicit

  const secretPath = path.join(dataDir, SECRET_FILE)
  try {
    const existing = (await fs.readFile(secretPath, 'utf8')).trim()
    if (existing.length >= 32) return existing
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }

  const generated = crypto.randomBytes(48).toString('base64url')
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(secretPath, `${generated}\n`)
  return generated
}
