#!/usr/bin/env node
// B5：SaaS 偏好键改为身份 (zone, FQDN)，旧 hostnameId 键在启动时无损收编；
// B7：moved 主机名不再算「在管」，不得进入所有权 TXT 清理流程
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadAppConfig } from '../server/app/config.js'
import { createModules } from '../server/app/modules.js'
import { isHostnameActive } from '../server/modules/cloudflare/saas/saas-hostname-rules.js'
import { SaaSDnsSyncWorkflow } from '../server/workflows/saas-dns-sync/saas-dns-sync.workflow.js'

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-pro-saas-pref-'))
const preferencesFile = path.join(dataDir, 'saas', 'preferences.json')
await fs.mkdir(path.dirname(preferencesFile), { recursive: true })
// 旧版键模型：`<cloudflareProviderId>:<hostnameId>`；无 hostname 的旧行无法归属到 FQDN
await fs.writeFile(
  preferencesFile,
  JSON.stringify({
    items: {
      'cf-owner:h-legacy': { hostname: 'legacy.example.com', preferred_domain: 'p.example.com' },
      'cf-owner:h-unowned': { preferred_domain: 'orphan.example.com' },
    },
  })
)
await fs.writeFile(
  path.join(dataDir, 'providers.json'),
  JSON.stringify({
    items: [
      { id: 'cf-owner', name: 'CF owner', type: 'cloudflare', api_token: 'probe-token' },
      { id: 'dns-target', name: 'DNS target', type: 'dnspod', secret_id: 'probe-id', secret_key: 'probe-key' },
    ],
  })
)

const config = loadAppConfig({
  dataDir,
  logLevel: false,
  sessionSecret: 'probe-session-secret-that-is-longer-than-thirty-two-characters',
})
const modules = createModules(config, { credentialKey: Buffer.alloc(32, 7) })
const preferences = modules.saas.preferences

async function fileRows(): Promise<Record<string, Record<string, unknown>>> {
  const raw = JSON.parse(await fs.readFile(preferencesFile, 'utf8')) as { items: Record<string, unknown> }
  return raw.items as Record<string, Record<string, unknown>>
}

// 1. 启动收编：可归属的旧键行迁移为 `<cfId>:<fqdn>`（站点未知），无法归属的旧行清除
const providers = await modules.providers.repository.all()
const pruned = await preferences.pruneOrphans(
  new Set(providers.filter((provider) => provider.type === 'cloudflare').map((provider) => provider.id)),
  new Set(providers.map((provider) => provider.id))
)
assert.equal(pruned.removedCount, 1, '无 hostname 的旧键行必须清除')
assert.equal(pruned.repairedCount, 1, '可归属的旧键行必须收编')
let rows = await fileRows()
assert.deepEqual(Object.keys(rows), ['cf-owner::legacy.example.com'], '旧键行必须迁移到站点未知身份键')
assert.equal(rows['cf-owner::legacy.example.com']?.hostname_id, 'h-legacy', '旧键里的 hostnameId 必须留作辅助索引')
assert.equal(
  (await preferences.get('cf-owner', { zone: 'example.com', fqdn: 'legacy.example.com' }))?.preferred_domain,
  'p.example.com',
  '收编后的旧数据必须仍可读（无损迁移）'
)

// 2. 身份键：带站点写入后落在 `<cfId>:<zone>:<fqdn>`，不再出现旧键形状
await preferences.setPreferredDomain(
  'cf-owner',
  { zone: 'example.com', fqdn: 'www.example.com' },
  'pref.example.com',
  'h-1'
)
rows = await fileRows()
assert.ok(rows['cf-owner:example.com:www.example.com'], '偏好必须按身份键落盘')
assert.equal(rows['cf-owner:h-1'], undefined, '不得再写旧 hostnameId 键')
assert.equal(rows['cf-owner:example.com:www.example.com']?.hostname_id, 'h-1', 'hostnameId 仅作行内辅助索引')

// 3. 同一 FQDN 跨站点不互相命中（旧键模型下会被同一个 hostnameId 覆盖）
await preferences.setSyncConfig({
  cloudflareProviderId: 'cf-owner',
  identity: { zone: 'other.com', fqdn: 'www.example.com' },
  hostnameId: 'h-1',
  syncTarget: 'dnspod',
  syncProviderId: 'dns-target',
  syncZone: 'example.com',
  autoPreferred: false,
})
const sameFqdn = await preferences.get('cf-owner', { zone: 'example.com', fqdn: 'www.example.com' })
assert.equal(sameFqdn?.preferred_domain, 'pref.example.com', '同 FQDN 其他站点的写入不得污染本站点偏好')
assert.equal(sameFqdn?.sync_target, '', '同 FQDN 其他站点的同步配置不得串入本站点')
assert.equal(
  (await preferences.get('cf-owner', { zone: 'other.com', fqdn: 'www.example.com' }))?.sync_target,
  'dnspod',
  '各站点偏好必须独立可读'
)

// 4. 写入即收编：带站点写入把站点未知行并入身份键
await preferences.setPreferredDomain('cf-owner', { zone: 'example.com', fqdn: 'legacy.example.com' }, 'p2.example.com')
rows = await fileRows()
assert.equal(rows['cf-owner::legacy.example.com'], undefined, '站点未知行必须被收编，不得留孤儿')
assert.equal(rows['cf-owner:example.com:legacy.example.com']?.preferred_domain, 'p2.example.com')

// 5. 所有权 TXT 标记仍按 hostnameId 寻址，但不得把身份键降级成站点未知键
await preferences.markOwnershipTxtCleaned('cf-owner', 'h-1', true, 'www.example.com')
assert.equal(await preferences.ownershipTxtCleaned('cf-owner', 'h-1'), true, '所有权标记必须可读')
rows = await fileRows()
assert.equal(rows['cf-owner::www.example.com'], undefined, '所有权标记不得新建站点未知行')
assert.equal(rows['cf-owner:example.com:www.example.com']?.ownership_txt_cleaned, true, '标记必须写回身份键行')

// 6. 删除主机名按 FQDN 清干净所有站点行，且不误伤其他主机名
const cleared = await preferences.clearForFqdn('cf-owner', 'www.example.com')
assert.equal(cleared, 2, '同 FQDN 的全部站点行都必须清除')
rows = await fileRows()
assert.deepEqual(
  Object.keys(rows).sort(),
  ['cf-owner:example.com:legacy.example.com'],
  '清理后只应留下其他主机名的偏好'
)

// 7. B7：状态判定只认真正在管的主机名
assert.equal(isHostnameActive({ status: 'active' }), true)
assert.equal(isHostnameActive({ status: 'active_renewing' }), true)
assert.equal(isHostnameActive({ status: 'moved' }), false, 'moved 主机名已迁出，不得视为在管')
assert.equal(isHostnameActive({ status: 'pending' }), false)
assert.equal(isHostnameActive({}), false)

// 8. B7 门槛：moved 时连偏好查询都不该发生（清理流程整体不进入）
const lookups: string[] = []
const gate = new SaaSDnsSyncWorkflow(
  // 规则端口用真实判定实现：门槛必须与主机名状态判定同口径，mock 只固定服务商解析
  { cloudflareProviderId: async () => 'cf-owner', isHostnameActive } as never,
  {
    ownershipTxtCleaned: async (_cfId: string, hostnameId: string) => {
      lookups.push(hostnameId)
      return false
    },
  } as never,
  {} as never
)
const shouldCleanup = (
  gate as unknown as {
    shouldCleanupOwnershipTxt(providerId: string, hostname: { id?: string; status?: string }): Promise<boolean>
  }
).shouldCleanupOwnershipTxt
assert.equal(typeof shouldCleanup, 'function', 'SaaS 所有权 TXT 清理门槛缺失')
assert.equal(
  await shouldCleanup.call(gate, 'saas-owner', { id: 'h-1', status: 'moved' }),
  false,
  'moved 不得进入清理流程'
)
assert.deepEqual(lookups, [], 'moved 主机名不得查询所有权标记')
assert.equal(
  await shouldCleanup.call(gate, 'saas-owner', { id: 'h-1', status: 'active' }),
  true,
  'active 必须进入清理流程'
)
assert.deepEqual(lookups, ['h-1'], 'active 主机名必须查询所有权标记')

// 9. 优选域名白名单：写入侧（create）收下的等价写法，必须在改名/删除/校验侧命中同一身份。
// 带尾点/协议/大小写的写法若在改名或删除时落到 not_found，用户会看到「刚创建成功的域名不存在」。
const preferredDomains = modules.saas.preferredDomains
await preferredDomains.create('https://Pref.Example.com/some/path')
assert.deepEqual(
  await preferredDomains.list(),
  [{ domain: 'pref.example.com', sort: 0 }],
  '白名单写入必须落归一化裸域名'
)
assert.equal(await preferredDomains.isAllowed(' PREF.EXAMPLE.COM. '), true, '尾点/大小写/空白等价写法必须判真')

// 改名的旧值用等价写法必须命中；新值同样归一化；改完后新旧域名的判定必须翻转
assert.deepEqual(
  await preferredDomains.rename('PREF.EXAMPLE.COM.', 'Second.Example.com.'),
  { domain: 'second.example.com', sort: 0 },
  '改名必须接受带尾点/大小写的等价旧值，并把新值归一化落盘'
)
assert.equal(await preferredDomains.isAllowed('https://second.example.com/x'), true, '改名后的新域名必须判真')
assert.equal(await preferredDomains.isAllowed('pref.example.com.'), false, '改名后的旧域名不得再判真')

// 排序的归一化分支：带尾点/协议/大小写/空白的等价写法必须命中已有域名，重复/空白/未知/非法值忽略
await preferredDomains.create('third.example.com')
assert.deepEqual(
  (
    await preferredDomains.reorder([
      ' https://THIRD.example.com/some/path ',
      'second.example.com.',
      'SECOND.example.com',
      'https://',
      ' ',
      'unknown.example.com',
    ])
  ).map((item) => item.domain),
  ['third.example.com', 'second.example.com'],
  '排序必须接受带尾点/协议/大小写/空白的等价写法，并保持重复/未知/非法值忽略的原语义'
)

// 删除键同样接受等价写法；删除后判定必须翻转；非法/空值统一落 not_found 而不是 500
await preferredDomains.delete(' second.example.com. ')
assert.equal(await preferredDomains.isAllowed('second.example.com'), false, '删除键带尾点/空白必须命中并清除')
assert.deepEqual(
  (await preferredDomains.list()).map((item) => item.domain),
  ['third.example.com'],
  '删除后只应留下未受影响的域名'
)
const preferredErrorCode = (run: () => Promise<unknown>) =>
  run().then(
    () => null,
    (error: unknown) => (error as { code?: string }).code
  )
assert.equal(
  await preferredErrorCode(() => preferredDomains.rename('https://', 'fourth.example.com')),
  'preferred_domain_not_found',
  '改名的非法旧值必须落到 not_found'
)
assert.equal(
  await preferredErrorCode(() => preferredDomains.delete('')),
  'preferred_domain_not_found',
  '删除的空值必须落到 not_found'
)

await fs.rm(dataDir, { recursive: true, force: true })
console.log(
  'saas-preference-probe=ok key=identity migrate=legacy adopt=on-write ownership=id-addressed moved=excluded preferred=create/rename/delete/reorder-normalized'
)
