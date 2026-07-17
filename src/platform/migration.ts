import fs from 'node:fs/promises'
import path from 'node:path'
import { getDataRoot } from '../lib/storage/json-store.js'

export const DATA_SCHEMA_VERSION = 1

type MetaFile = {
  schema_version: number
  updated_at: number
}

type Migration = {
  version: number
  name: string
  up: (dataRoot: string) => Promise<void>
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'init-schema-meta',
    async up(dataRoot) {
      // Ensure canonical data directories exist for modular features.
      await fs.mkdir(path.join(dataRoot, 'saas'), { recursive: true })
      await fs.mkdir(path.join(dataRoot, 'jobs'), { recursive: true })
    },
  },
]

async function readMeta(dataRoot: string): Promise<MetaFile> {
  const file = path.join(dataRoot, 'meta.json')
  try {
    const raw = await fs.readFile(file, 'utf-8')
    const parsed = JSON.parse(raw) as MetaFile
    return {
      schema_version: Number(parsed.schema_version || 0),
      updated_at: Number(parsed.updated_at || 0),
    }
  } catch {
    return { schema_version: 0, updated_at: 0 }
  }
}

async function writeMeta(dataRoot: string, meta: MetaFile): Promise<void> {
  const file = path.join(dataRoot, 'meta.json')
  await fs.mkdir(dataRoot, { recursive: true })
  await fs.writeFile(file, `${JSON.stringify(meta, null, 2)}\n`, 'utf-8')
}

/**
 * Run pending data migrations. Safe to call on every boot.
 * No backward compatibility shims — schema only moves forward.
 */
export async function runMigrations(dataRoot = getDataRoot()): Promise<{ from: number; to: number }> {
  const meta = await readMeta(dataRoot)
  const from = meta.schema_version
  let current = from

  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version)
  for (const migration of pending) {
    await migration.up(dataRoot)
    current = migration.version
    await writeMeta(dataRoot, { schema_version: current, updated_at: Date.now() })
  }

  if (current < DATA_SCHEMA_VERSION) {
    // If code expects a newer version than registered migrations, stamp target.
    current = DATA_SCHEMA_VERSION
    await writeMeta(dataRoot, { schema_version: current, updated_at: Date.now() })
  }

  if (from === 0 && pending.length === 0) {
    await writeMeta(dataRoot, { schema_version: DATA_SCHEMA_VERSION, updated_at: Date.now() })
    return { from: 0, to: DATA_SCHEMA_VERSION }
  }

  return { from, to: current }
}
