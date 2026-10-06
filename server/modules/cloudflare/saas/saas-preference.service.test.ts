import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSecretBox } from '../../../core/crypto/secret-box.js'
import { ProviderIntegrity } from '../../../core/providers/provider-integrity.js'
import { ProviderRepository } from '../../../core/providers/provider.repository.js'
import { createStore } from '../../../core/store/store-registry.js'
import { SaaSPreferenceService } from './saas-preference.service.js'

/**
 * 启动清理孤儿偏好（原 scripts/isolated-backend-safe-probe.ts 的收尾断言）：
 * 清理必须返回可读的删除计数，界面/日志据此判断是否发生了数据修复；
 * 干净数据目录下不得凭空产生删除。
 */

let dataRoot = ''

beforeEach(async () => {
  dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-pro-saas-pref-'))
})

afterEach(async () => {
  await fs.rm(dataRoot, { recursive: true, force: true })
})

async function createHarness() {
  const providerStore = createStore('providers', dataRoot)
  await providerStore.write({ items: [] })
  const providers = new ProviderRepository(providerStore, createSecretBox(Buffer.alloc(32, 7)))
  const prefStore = createStore('saasPreferences', dataRoot)
  const preferences = new SaaSPreferenceService(prefStore, new ProviderIntegrity(), providers)
  return { preferences, prefStore }
}

describe('SaaSPreferenceService.pruneOrphans', () => {
  it('干净目录返回数字型 removedCount，且不产生无中生有的删除', async () => {
    const { preferences } = await createHarness()
    const result = await preferences.pruneOrphans(new Set(), new Set())
    expect(typeof result.removedCount).toBe('number')
    expect(result.removedCount).toBe(0)
  })
})
