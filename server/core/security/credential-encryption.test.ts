import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSecretBox } from '../crypto/secret-box.js'
import { ProviderRepository } from '../providers/provider.repository.js'
import { migrateDataRoot } from '../store/migrations.js'
import { createStore } from '../store/store-registry.js'
import { loadCredentialKey } from './credential-key.js'

/**
 * Provider 凭据的静态加密（迁移自 scripts/isolated-credential-encryption-probe.ts）：
 * 磁盘上是密文、内存与返回值是明文、旧明文透明兼容、迁移 001 封存存量明文、密钥不匹配显式失败。
 */

const log = { info: () => undefined }

async function readJson(target: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(target, 'utf8')) as Record<string, unknown>
}

function makeRoot(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function repositoryAt(root: string): Promise<ProviderRepository> {
  return new ProviderRepository(createStore('providers', root), createSecretBox(await loadCredentialKey(root)))
}

describe('Provider 凭据的静态加密', () => {
  it('写入：磁盘密文，内存与返回值保持明文', async () => {
    const root = await makeRoot('dns-credential-')
    const repository = await repositoryAt(root)

    const created = await repository.mutateAll(() => [
      { type: 'cloudflare', id: 'cf-1', name: 'main', api_token: 'super-secret-token', account_id: 'acc-1' },
    ])
    expect(created[0], '写入返回值必须保持明文').toMatchObject({ api_token: 'super-secret-token' })

    const sealedFile = await fs.readFile(path.join(root, 'providers.json'), 'utf8')
    expect(sealedFile, '磁盘不得出现明文凭据').not.toMatch(/super-secret-token/)
    expect(sealedFile, '磁盘必须写入加密值').toMatch(/enc:v1:/)

    const reloaded = await repository.all({ fresh: true })
    expect(reloaded[0], '读取必须解密还原').toMatchObject({ api_token: 'super-secret-token' })
  })

  it('旧明文数据透明兼容（尚未迁移的部署）', async () => {
    const legacyRoot = await makeRoot('dns-credential-legacy-')
    await fs.writeFile(
      path.join(legacyRoot, 'providers.json'),
      `${JSON.stringify(
        { items: [{ type: 'dnspod', id: 'dp-1', name: 'legacy', secret_id: 'sid', secret_key: 'plain-key' }] },
        null,
        2
      )}\n`
    )

    const legacy = await (await repositoryAt(legacyRoot)).all({ fresh: true })
    expect(legacy[0], '旧明文数据必须可读').toMatchObject({ secret_key: 'plain-key' })
  })

  it('迁移 001：存量明文被加密，备份与 meta 同步落位', async () => {
    const migrationRoot = await makeRoot('dns-credential-migrate-')
    await fs.writeFile(
      path.join(migrationRoot, 'providers.json'),
      `${JSON.stringify(
        { items: [{ type: 'cloudflare', id: 'cf-2', name: 'old', api_token: 'to-be-encrypted', account_id: 'a' }] },
        null,
        2
      )}\n`
    )

    await migrateDataRoot(migrationRoot, log)

    const migratedFile = await fs.readFile(path.join(migrationRoot, 'providers.json'), 'utf8')
    expect(migratedFile, '迁移后磁盘不得保留明文').not.toMatch(/to-be-encrypted/)
    expect(migratedFile).toMatch(/enc:v1:/)
    expect((await readJson(path.join(migrationRoot, '__meta.json'))).schema_version, 'meta 必须推进到 1').toBe(1)
    expect((await fs.readdir(path.join(migrationRoot, 'backups'))).length, '迁移必须留备份').toBe(1)

    const migrated = await (await repositoryAt(migrationRoot)).all({ fresh: true })
    expect(migrated[0], '迁移后必须可解密读出原文').toMatchObject({ api_token: 'to-be-encrypted' })
  })

  it('密钥不匹配：显式失败，绝不静默降级为密文', async () => {
    const root = await makeRoot('dns-credential-rotation-')
    const repository = await repositoryAt(root)
    await repository.mutateAll(() => [
      { type: 'cloudflare', id: 'cf-1', name: 'main', api_token: 'sealed-with-original-key', account_id: 'acc-1' },
    ])

    // 轮换后的密钥读旧数据：必须抛错，而不是把密文当成明文返回
    const rotated = new ProviderRepository(createStore('providers', root), createSecretBox(Buffer.alloc(32, 7)))
    await expect(rotated.all({ fresh: true }), '密钥不匹配必须显式报错').rejects.toThrow(/decrypt/i)
    await expect(rotated.all({ fresh: true })).rejects.toMatchObject({ code: 'credential_decrypt_failed' })
  })
})
