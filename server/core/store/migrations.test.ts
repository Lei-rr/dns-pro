import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { backupDataRoot, backupLabel, pruneBackups } from '../backup/backup.service.js'
import { CURRENT_SCHEMA_VERSION, migrateDataRoot, type Migration } from './migrations.js'

/**
 * 迁移自 scripts/isolated-data-migration-probe.ts（数据目录版本化迁移 + 备份保留）。
 * 关键语义：启动期迁移必须幂等（失败可重跑）、执行前必留整目录备份、
 * 备份保留只计已完成的正式备份（原子改名成功后才算数）。
 */

const log = { info: () => undefined }
const tempDir = (prefix: string) => fs.mkdtemp(path.join(os.tmpdir(), prefix))
const exists = async (target: string) =>
  fs
    .access(target)
    .then(() => true)
    .catch(() => false)
const readJson = async (target: string) => JSON.parse(await fs.readFile(target, 'utf8')) as Record<string, unknown>

describe('migrateDataRoot：版本推进与备份', () => {
  it('首次运行：只写 meta，不产生备份', async () => {
    const fresh = await tempDir('dns-migration-fresh-')
    await migrateDataRoot(fresh, log)
    expect((await readJson(path.join(fresh, '__meta.json'))).schema_version).toBe(CURRENT_SCHEMA_VERSION)
    expect(await exists(path.join(fresh, 'backups'))).toBe(false)
  })

  it('已有数据且无 meta：从 0 起按版本顺序全部执行，执行前整目录备份，重跑幂等', async () => {
    const legacy = await tempDir('dns-migration-legacy-')
    await fs.writeFile(path.join(legacy, 'providers.json'), '{"items":[]}\n')
    const applied: number[] = []
    const table: Migration[] = [
      { version: 1, description: 'first', apply: async () => void applied.push(1) },
      { version: 2, description: 'second', apply: async () => void applied.push(2) },
    ]
    await migrateDataRoot(legacy, log, { migrations: table })
    expect(applied).toEqual([1, 2])
    expect((await readJson(path.join(legacy, '__meta.json'))).schema_version).toBe(2)
    const backups = await fs.readdir(path.join(legacy, 'backups'))
    expect(backups).toHaveLength(1)
    const firstBackup = backups[0] ?? ''
    // 备份名必须记录来源版本与时间
    expect(firstBackup).toMatch(/^pre-v0-\d{8}-\d{6}$/)
    expect(await readJson(path.join(legacy, 'backups', firstBackup, 'providers.json'))).toEqual({ items: [] })
    expect(await exists(path.join(legacy, 'backups', firstBackup, 'backups'))).toBe(false)

    // 幂等：版本已推进，重跑不重复执行、不新增备份
    await migrateDataRoot(legacy, log, { migrations: table })
    expect(applied).toEqual([1, 2])
    expect((await fs.readdir(path.join(legacy, 'backups'))).length).toBe(1)
  })

  it('迁移失败即停：meta 停在最后成功的版本，备份仍在，可安全重跑', async () => {
    const failing = await tempDir('dns-migration-fail-')
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
    await expect(migrateDataRoot(failing, log, { migrations: brokenTable })).rejects.toThrow('boom')
    expect((await readJson(path.join(failing, '__meta.json'))).schema_version).toBe(1)
    expect(await exists(path.join(failing, 'backups'))).toBe(true)
  })
})

describe('备份服务：原子改名与保留策略', () => {
  it('备份先写临时目录再原子改名，保留策略只留最近 keep 份正式备份', async () => {
    const dataDir = await tempDir('dns-migration-retention-')
    for (let index = 0; index < 4; index += 1) {
      await backupDataRoot(dataDir, backupLabel(`keep-${index}`))
    }
    // 原子改名成功后不得留下临时残留
    const finished = await fs.readdir(path.join(dataDir, 'backups'))
    expect(finished.some((name) => name.startsWith('.tmp-'))).toBe(false)

    // 写入中途退出留下的临时残留：既不计数也不删除
    await fs.mkdir(path.join(dataDir, 'backups', '.tmp-interrupted'), { recursive: true })
    const beforePrune = (await fs.readdir(path.join(dataDir, 'backups'))).length
    expect(beforePrune).toBeGreaterThanOrEqual(5)
    const removed = await pruneBackups(dataDir, 2)
    const afterPrune = await fs.readdir(path.join(dataDir, 'backups'))
    expect(afterPrune.filter((name) => !name.startsWith('.tmp-')).length).toBe(2)
    expect(afterPrune.some((name) => name.startsWith('.tmp-'))).toBe(true)
    expect(removed).toBe(beforePrune - 3)
  })
})
