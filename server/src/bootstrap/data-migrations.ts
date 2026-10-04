import fs from 'node:fs/promises'
import path from 'node:path'
import { sealProviderSecrets } from '../modules/providers/provider-secrets.js'
import type { Provider } from '../modules/providers/provider.types.js'
import { loadCredentialKey } from '../platform/security/credential-key.js'
import { createSecretBox } from '../platform/security/secret-box.js'
import { backupDataRoot, backupLabel, pruneBackups } from '../platform/storage/data-backup.js'
import { storePaths } from './store-registry.js'

/** 当前数据结构版本；新增迁移时递增并追加到 migrations 末尾 */
export const CURRENT_SCHEMA_VERSION = 1

const META_FILE = '__meta.json'
const BACKUP_RETENTION = 5

export interface MigrationLogger {
  info: (message: string) => void
}

/** 数据迁移：把 dataRoot 从 version-1 的结构升级到 version；必须幂等（失败可重跑） */
export interface Migration {
  readonly version: number
  readonly description: string
  readonly apply: (dataRoot: string) => Promise<void>
}

/**
 * 迁移表：version 严格递增，每个迁移必须幂等（失败可重跑）。
 * 001：存量 provider 凭据（secret_key / api_token）落盘加密。
 */
const migrations: readonly Migration[] = [
  {
    version: 1,
    description: 'encrypt provider credentials at rest',
    apply: async (dataRoot) => {
      const box = createSecretBox(await loadCredentialKey(dataRoot))
      const filePath = path.join(dataRoot, 'providers.json')
      const raw = await fs.readFile(filePath, 'utf8').catch(() => null)
      if (raw === null || raw.trim() === '') return
      const parsed = JSON.parse(raw) as { items?: Provider[] }
      const items = Array.isArray(parsed.items) ? parsed.items : []
      await writeJsonAtomic(filePath, { ...parsed, items: items.map((item) => sealProviderSecrets(item, box)) })
    },
  },
]

interface DataMeta {
  schema_version: number
  updated_at: string
}

/**
 * 启动期数据迁移：按 __meta.json 补齐待执行迁移，执行前自动整目录备份。
 * - 无 meta 且已有数据文件 → 视为最早版本（0），执行全部迁移
 * - 无 meta 且无数据 → 首次运行，直接写入当前版本
 * - 迁移失败：meta 不推进，下次启动重跑（有备份兜底）
 */
export async function migrateDataRoot(
  dataRoot: string,
  log: MigrationLogger,
  /** 仅测试注入；生产运行使用内置迁移表 */
  overrides: { migrations?: readonly Migration[] } = {}
): Promise<void> {
  const metaPath = path.join(dataRoot, META_FILE)
  const meta = await readMeta(metaPath)
  const from = meta ? meta.schema_version : (await hasExistingData(dataRoot)) ? 0 : CURRENT_SCHEMA_VERSION
  const pending = (overrides.migrations ?? migrations)
    .filter((migration) => migration.version > from)
    .sort((a, b) => a.version - b.version)
  if (pending.length === 0) {
    if (!meta) await writeMeta(metaPath, CURRENT_SCHEMA_VERSION)
    return
  }

  const target = await backupDataRoot(dataRoot, backupLabel(`pre-v${from}`))
  log.info(`data migration: backed up to ${target}`)
  await pruneBackups(dataRoot, BACKUP_RETENTION)
  for (const migration of pending) {
    log.info(`data migration ${migration.version}: ${migration.description}`)
    await migration.apply(dataRoot)
    await writeMeta(metaPath, migration.version)
  }
}

async function readMeta(metaPath: string): Promise<DataMeta | null> {
  const content = await fs.readFile(metaPath, 'utf8').catch(() => null)
  if (content === null) return null
  try {
    const parsed = JSON.parse(content) as Partial<DataMeta>
    const version = Number(parsed.schema_version)
    if (!Number.isSafeInteger(version) || version < 0) return null
    return { schema_version: version, updated_at: String(parsed.updated_at ?? '') }
  } catch {
    // 损坏的 meta 按缺失处理：迁移幂等且有备份兜底
    return null
  }
}

async function writeMeta(metaPath: string, version: number): Promise<void> {
  await writeJsonAtomic(metaPath, { schema_version: version, updated_at: new Date().toISOString() })
}

/** 临时文件 + fsync + rename 的原子 JSON 写入（迁移期 store 尚未创建） */
async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const temporary = `${filePath}.${process.pid}.tmp`
  const handle = await fs.open(temporary, 'w', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fs.rename(temporary, filePath)
}

async function hasExistingData(dataRoot: string): Promise<boolean> {
  for (const relativePath of storePaths()) {
    const found = await fs
      .access(path.join(dataRoot, relativePath))
      .then(() => true)
      .catch(() => false)
    if (found) return true
  }
  return false
}
