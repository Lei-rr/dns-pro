#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { migrateDataRoot } from '../server/core/store/migrations.js'
import { createStore } from '../server/core/store/store-registry.js'
import { ProviderRepository, type ProvidersFile } from '../server/core/providers/provider.repository.js'
import { loadCredentialKey } from '../server/core/security/credential-key.js'
import { createSecretBox } from '../server/core/crypto/secret-box.js'

const log = { info: () => undefined }
const readJson = async (target: string) => JSON.parse(await fs.readFile(target, 'utf8')) as Record<string, unknown>
const repositoryAt = async (root: string) => {
  return new ProviderRepository(
    createStore<ProvidersFile>('providers', root),
    createSecretBox(await loadCredentialKey(root))
  )
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-credential-'))
try {
  const repository = await repositoryAt(root)

  // 1. 写入：磁盘密文，内存与返回值保持明文
  const created = await repository.mutateAll(() => [
    { type: 'cloudflare', id: 'cf-1', name: 'main', api_token: 'super-secret-token', account_id: 'acc-1' },
  ])
  assert.equal(created[0].api_token, 'super-secret-token', '写入返回值必须保持明文')
  const sealedFile = await fs.readFile(path.join(root, 'providers.json'), 'utf8')
  assert.doesNotMatch(sealedFile, /super-secret-token/, '磁盘不得出现明文凭据')
  assert.match(sealedFile, /enc:v1:/, '磁盘必须写入加密值')
  const reloaded = await repository.all({ fresh: true })
  assert.equal(reloaded[0].api_token, 'super-secret-token', '读取必须解密还原')

  // 2. 明文旧数据透明兼容（尚未迁移的部署）
  const legacyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-credential-legacy-'))
  try {
    await fs.writeFile(
      path.join(legacyRoot, 'providers.json'),
      `${JSON.stringify({ items: [{ type: 'dnspod', id: 'dp-1', name: 'legacy', secret_id: 'sid', secret_key: 'plain-key' }] }, null, 2)}\n`
    )
    const legacy = await (await repositoryAt(legacyRoot)).all({ fresh: true })
    assert.equal(legacy[0].secret_key, 'plain-key', '旧明文数据必须可读')
  } finally {
    await fs.rm(legacyRoot, { recursive: true, force: true })
  }

  // 3. 迁移 001：存量明文被加密，备份与 meta 同步落位
  const migrationRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-credential-migrate-'))
  try {
    await fs.writeFile(
      path.join(migrationRoot, 'providers.json'),
      `${JSON.stringify({ items: [{ type: 'cloudflare', id: 'cf-2', name: 'old', api_token: 'to-be-encrypted', account_id: 'a' }] }, null, 2)}\n`
    )
    await migrateDataRoot(migrationRoot, log)
    const migratedFile = await fs.readFile(path.join(migrationRoot, 'providers.json'), 'utf8')
    assert.doesNotMatch(migratedFile, /to-be-encrypted/, '迁移后磁盘不得保留明文')
    assert.match(migratedFile, /enc:v1:/)
    assert.equal((await readJson(path.join(migrationRoot, '__meta.json'))).schema_version, 1, 'meta 必须推进到 1')
    assert.equal((await fs.readdir(path.join(migrationRoot, 'backups'))).length, 1, '迁移必须留备份')
    const migrated = await (await repositoryAt(migrationRoot)).all({ fresh: true })
    assert.equal(migrated[0].api_token, 'to-be-encrypted', '迁移后必须可解密读出原文')
  } finally {
    await fs.rm(migrationRoot, { recursive: true, force: true })
  }

  // 4. 密钥不匹配：显式失败，绝不静默降级为密文
  const rotated = new ProviderRepository(
    createStore<ProvidersFile>('providers', root),
    createSecretBox(Buffer.alloc(32, 7))
  )
  await assert.rejects(() => rotated.all({ fresh: true }), /decrypt/i, '密钥不匹配必须显式报错')

  console.log(
    'credential-encryption-probe=ok disk=ciphertext memory=plaintext legacy=readable migration=sealed rotation=rejected'
  )
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
