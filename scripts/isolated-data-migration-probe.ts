#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { CURRENT_SCHEMA_VERSION, migrateDataRoot, type Migration } from '../server/src/bootstrap/data-migrations.js'
import { backupDataRoot, backupLabel, pruneBackups } from '../server/src/platform/storage/data-backup.js'

const log = { info: () => undefined }
const exists = async (target: string) =>
  fs
    .access(target)
    .then(() => true)
    .catch(() => false)
const readJson = async (target: string) => JSON.parse(await fs.readFile(target, 'utf8')) as Record<string, unknown>

const fresh = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-migration-fresh-'))
const legacy = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-migration-legacy-'))
try {
  // 1. 首次运行：只写 meta，不产生备份
  await migrateDataRoot(fresh, log)
  assert.equal((await readJson(path.join(fresh, '__meta.json'))).schema_version, CURRENT_SCHEMA_VERSION)
  assert.equal(await exists(path.join(fresh, 'backups')), false, '首次运行不得产生备份')

  // 2. 已有数据且无 meta：从 0 起按版本顺序全部执行，执行前整目录备份
  await fs.writeFile(path.join(legacy, 'providers.json'), '{"items":[]}\n')
  const applied: number[] = []
  const table: Migration[] = [
    { version: 1, description: 'first', apply: async () => void applied.push(1) },
    { version: 2, description: 'second', apply: async () => void applied.push(2) },
  ]
  await migrateDataRoot(legacy, log, { migrations: table })
  assert.deepEqual(applied, [1, 2], '迁移必须按版本顺序全部执行')
  assert.equal((await readJson(path.join(legacy, '__meta.json'))).schema_version, 2, 'meta 必须推进到最后执行的迁移')
  const backups = await fs.readdir(path.join(legacy, 'backups'))
  assert.equal(backups.length, 1, '迁移必须产生一次备份')
  assert.match(backups[0], /^pre-v0-\d{8}-\d{6}$/, '备份名必须记录来源版本与时间')
  assert.deepEqual(await readJson(path.join(legacy, 'backups', backups[0], 'providers.json')), { items: [] })
  assert.equal(await exists(path.join(legacy, 'backups', backups[0], 'backups')), false, '备份不得递归包含 backups')

  // 3. 幂等：版本已推进，重跑不重复执行、不新增备份
  await migrateDataRoot(legacy, log, { migrations: table })
  assert.deepEqual(applied, [1, 2], '重跑不得重复执行迁移')
  assert.equal((await fs.readdir(path.join(legacy, 'backups'))).length, 1, '重跑不得产生新备份')

  // 4. 迁移失败：meta 停在最后成功的版本，备份仍在，可安全重跑
  const failing = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-migration-fail-'))
  try {
    await fs.writeFile(path.join(failing, 'config.json'), '{"auth":{"username":"x"}}\n')
    const brokenTable: Migration[] = [
      { version: 1, description: 'ok', apply: async () => undefined },
      {
        version: 2,
        description: 'boom',
        apply: async () => {
          throw new Error('boom')
        },
      },
    ]
    await assert.rejects(() => migrateDataRoot(failing, log, { migrations: brokenTable }))
    assert.equal((await readJson(path.join(failing, '__meta.json'))).schema_version, 1, '失败迁移不得推进 meta')
    assert.equal(await exists(path.join(failing, 'backups')), true, '执行前必须留好备份')
  } finally {
    await fs.rm(failing, { recursive: true, force: true })
  }

  // 5. 保留策略：只留最近 keep 份
  for (let index = 0; index < 3; index += 1) {
    await backupDataRoot(legacy, backupLabel(`keep-${index}`))
  }
  const beforePrune = (await fs.readdir(path.join(legacy, 'backups'))).length
  assert.ok(beforePrune >= 4, '前置备份数量应足够')
  const removed = await pruneBackups(legacy, 2)
  assert.equal((await fs.readdir(path.join(legacy, 'backups'))).length, 2, '保留策略必须只留最近 keep 份')
  assert.equal(removed, beforePrune - 2)

  console.log('data-migration-probe=ok first-run=meta legacy=ordered idempotent=yes failure=stops retention=pruned')
} finally {
  await fs.rm(fresh, { recursive: true, force: true })
  await fs.rm(legacy, { recursive: true, force: true })
}
