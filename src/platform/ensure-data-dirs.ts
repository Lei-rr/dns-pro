import fs from 'node:fs/promises'
import path from 'node:path'
import { getDataRoot } from '../lib/storage/json-store.js'

/**
 * Ensure data directories exist. No schema version / meta.json —
 * personal single-instance app: layout changes are code changes.
 */
export async function ensureDataDirs(dataRoot = getDataRoot()): Promise<void> {
  await fs.mkdir(dataRoot, { recursive: true })
  await fs.mkdir(path.join(dataRoot, 'saas'), { recursive: true })
  await fs.mkdir(path.join(dataRoot, 'jobs'), { recursive: true })
}
