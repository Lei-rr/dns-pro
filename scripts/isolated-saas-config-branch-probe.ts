#!/usr/bin/env node
// SaaS 目录关键分支：优选域名 CRUD 的归一化与顺序、CloudflareZoneService.idByName 的真实调用链、
// 同步配置归一化的目标切换/脏配置修复、隧道令牌签发与轮换
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ApiError } from '../server/core/http/api-error.js'
import { JsonStore } from '../server/core/store/json-store.js'
import { installProviderCacheState } from '../server/core/cache/provider-cache.js'
import { CloudflareClient } from '../server/modules/cloudflare/cloudflare.client.js'
import { CloudflareAccess } from '../server/modules/cloudflare/access.js'
import { CloudflareZoneService } from '../server/modules/cloudflare/cloudflare-zone.service.js'
import { TunnelService } from '../server/modules/cloudflare/tunnel/tunnel.service.js'
import { SaaSSyncConfigService } from '../server/modules/cloudflare/saas/saas-sync-config.service.js'
import { effectivePreferredDomain } from '../server/modules/cloudflare/saas/saas-hostname-rules.js'
import { saasDesiredRecords } from '../server/use-cases/derived-records/planners/saas.planner.js'
import {
  PreferredDomainService,
  type PreferredDomainsFile,
} from '../server/modules/cloudflare/saas/preferred-domain.service.js'

const expectApiError = (code: string, status: number) => (error: unknown) =>
  error instanceof ApiError && error.code === code && error.statusCode === status

async function rejectsCode(run: () => Promise<unknown>, code: string, status: number, what: string) {
  await assert.rejects(run(), expectApiError(code, status), `${what} 应报 ${code}/${status}`)
}

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-pro-saas-branch-'))
try {
  // ---- 1. 优选域名：写入侧与校验侧必须共用同一份归一化 ----
  const preferred = new PreferredDomainService(
    new JsonStore<PreferredDomainsFile>('saas/preferred-domains.json', { items: [] }, dataDir)
  )
  const created = await preferred.create('https://Pref.Example.com/some/path')
  assert.deepEqual(created, { domain: 'pref.example.com', sort: 0 }, '写入必须归一化为裸域名并给出序号')
  assert.equal(await preferred.isAllowed('pref.example.com.'), true, '尾点等价写法必须判真')
  assert.equal(await preferred.isAllowed('  PREF.EXAMPLE.COM  '), true, '大小写与空白等价写法必须判真')
  assert.equal(await preferred.isAllowed('http://pref.example.com/x'), true, '写入侧收下的写法在校验侧必须判真')
  assert.equal(await preferred.isAllowed('other.example.com'), false)
  assert.equal(await preferred.isAllowed(''), false, '空串不得判真')
  assert.equal(await preferred.isAllowed('not a domain'), false, '非法域名不得判真')

  await rejectsCode(() => preferred.create('pref.example.com.'), 'preferred_domain_duplicate', 422, '等价写法重复创建')
  await rejectsCode(() => preferred.create('http://'), 'preferred_domain_invalid', 422, '非法域名创建')

  await preferred.create('second.example.com')
  // 改名为自身的等价写法：不得被当成重复
  assert.deepEqual(
    await preferred.rename('pref.example.com', 'PREF.example.com.'),
    { domain: 'pref.example.com', sort: 0 },
    '改名成自身等价写法必须保留原序号'
  )
  await rejectsCode(
    () => preferred.rename('pref.example.com', 'second.example.com'),
    'preferred_domain_duplicate',
    422,
    '改名撞已有域名'
  )
  await rejectsCode(
    () => preferred.rename('missing.example.com', 'third.example.com'),
    'preferred_domain_not_found',
    404,
    '改名的源域名不存在'
  )

  await preferred.create('third.example.com')
  const reordered = await preferred.reorder([
    'second.example.com',
    'SECOND.example.com',
    ' ',
    'unknown.example.com',
    'pref.example.com',
  ])
  assert.deepEqual(
    reordered,
    [
      { domain: 'second.example.com', sort: 0 },
      { domain: 'pref.example.com', sort: 1 },
      { domain: 'third.example.com', sort: 2 },
    ],
    '排序只认已有域名：重复/空白/未知值必须忽略，未列出的域名按原序追加'
  )
  await rejectsCode(
    () => preferred.delete('missing.example.com'),
    'preferred_domain_not_found',
    404,
    '删除不存在的域名'
  )
  await preferred.delete('  SECOND.example.com  ')
  assert.deepEqual(
    (await preferred.list()).map((item) => item.domain),
    ['pref.example.com', 'third.example.com'],
    '删除必须按归一化后的大小写生效'
  )

  // 改名/删除的查键与写入键同源：尾点、协议前缀、路径都是等价写法，不得落到 404
  assert.deepEqual(
    await preferred.rename('THIRD.example.com.', 'https://Renamed.Example.com/path'),
    { domain: 'renamed.example.com', sort: 1 },
    '改名的源域名必须按写入侧归一化命中'
  )
  await preferred.delete('RENAMED.example.com.  ')
  assert.deepEqual(
    (await preferred.list()).map((item) => item.domain),
    ['pref.example.com'],
    '删除必须按写入侧归一化命中'
  )
  // 归一化失败/空值的查键按 not_found 处理（不是 422、更不是 500）
  await rejectsCode(
    () => preferred.rename('not a domain', 'fourth.example.com'),
    'preferred_domain_not_found',
    404,
    '非法源域名改名'
  )
  await rejectsCode(() => preferred.delete('http://'), 'preferred_domain_not_found', 404, '非法删除键')
  await rejectsCode(() => preferred.delete(''), 'preferred_domain_not_found', 404, '空删除键')
  await rejectsCode(
    () => preferred.rename('pref.example.com', 'not a domain'),
    'preferred_domain_invalid',
    422,
    '改名的新域名非法仍按 422'
  )

  // 存量数据（旧版写入或手工编辑）未归一化：读取侧必须与写入侧同源，不能只在写入侧判真、在读取侧判假
  await fs.writeFile(
    path.join(dataDir, 'saas', 'preferred-domains.json'),
    JSON.stringify({ items: ['https://Legacy.Example.com/path', 'legacy2.example.com.', 'not a domain', 42] })
  )
  const legacy = new PreferredDomainService(
    new JsonStore<PreferredDomainsFile>('saas/preferred-domains.json', { items: [] }, dataDir)
  )
  assert.equal(await legacy.isAllowed('legacy.example.com'), true, '存量协议前缀条目必须与写入侧同源判真')
  assert.equal(await legacy.isAllowed('legacy2.example.com'), true, '存量尾点条目必须判真')
  assert.deepEqual(
    (await legacy.list()).map((item) => item.domain),
    ['legacy.example.com', 'legacy2.example.com'],
    '读取侧必须归一化存量条目并丢弃非法条目'
  )

  // ---- 2. 真实服务商仓库 + 假上游：ZoneService / TunnelService / SyncConfigService 走同一访问链 ----
  const providerFixtures = new Map<string, Record<string, unknown>>([
    ['cf-1', { id: 'cf-1', type: 'cloudflare', name: 'CF', api_token: 'cf-token', account_id: 'acct-1' }],
    ['cf-no-account', { id: 'cf-no-account', type: 'cloudflare', name: 'CF bare', api_token: 'cf-token-2' }],
    ['tun-1', { id: 'tun-1', type: 'cloudflared', name: 'Tunnel', cloudflare_provider: 'cf-1' }],
    ['tun-unlinked', { id: 'tun-unlinked', type: 'cloudflared', name: 'Tunnel orphan', cloudflare_provider: '' }],
    [
      'tun-no-account',
      { id: 'tun-no-account', type: 'cloudflared', name: 'Tunnel bare', cloudflare_provider: 'cf-no-account' },
    ],
    [
      'saas-1',
      {
        id: 'saas-1',
        type: 'saas',
        name: 'SaaS',
        cloudflare_provider: 'cf-1',
        dnspod_provider: 'dns-1',
        cloudflare_dns_provider: 'cf-dns-1',
      },
    ],
    ['saas-cf-only', { id: 'saas-cf-only', type: 'saas', name: 'SaaS CF only', cloudflare_provider: 'cf-1' }],
    ['saas-unlinked', { id: 'saas-unlinked', type: 'saas', name: 'SaaS orphan', cloudflare_provider: '' }],
  ])
  const repository = {
    requireType: async (id: string, type: string, message: string, code: string) => {
      const provider = providerFixtures.get(id)
      if (!provider || provider.type !== type) throw new ApiError(code, message, 404)
      return provider
    },
  }
  const access = new CloudflareAccess(repository as never)
  const zones = new CloudflareZoneService(access)
  const tunnels = new TunnelService(access)
  const syncConfig = new SaaSSyncConfigService(repository as never, {} as never)

  installProviderCacheState()
  const zoneRequests: Array<Record<string, unknown>> = []
  const zonePages = new Map<number, unknown[]>([
    [1, [{ id: 'zone-www', name: 'WWW.example.com', status: 'active', type: 'full' }]],
    [2, [{ id: 'zone-other', name: 'other.example.com', status: 'active', type: 'full' }]],
  ])
  let zoneTotalPages = 3
  CloudflareClient.prototype.get = async function (
    requestPath: string,
    params: Record<string, unknown> = {}
  ): Promise<unknown> {
    assert.equal(requestPath, 'zones')
    zoneRequests.push(params)
    const page = Number(params.page ?? 1)
    return {
      success: true,
      result: zonePages.get(page) ?? [],
      result_info: { page, per_page: Number(params.per_page ?? 50), total_pages: zoneTotalPages },
    }
  }

  // 站点名按归一化后的形态过滤上游，命中即停止翻页；大小写差异不算未命中
  assert.equal(await zones.idByName('cf-1', '  WWW.Example.COM. '), 'zone-www', 'idByName 必须命中大小写/尾点变体')
  assert.equal(zoneRequests.length, 1, '命中后不得继续翻页')
  assert.equal(zoneRequests[0]?.name, 'www.example.com', '上游过滤值必须是归一化站点名')

  // 命中在第二页：必须继续翻页
  zoneRequests.length = 0
  zonePages.set(1, [{ id: 'zone-aaa', name: 'aaa.example.com', status: 'active', type: 'full' }])
  assert.equal(await zones.idByName('cf-1', 'other.example.com', true), 'zone-other', '第二页命中必须继续翻页')
  assert.deepEqual(
    zoneRequests.map((params) => params.page),
    [1, 2],
    '应逐页查询直到命中'
  )

  // 全量扫描后仍未命中：必须显式 404，不得把「找不到」当成空站点 ID
  zonePages.set(1, [])
  zonePages.set(2, [])
  zoneTotalPages = 1
  await rejectsCode(
    () => zones.idByName('cf-1', 'missing.example.com', true),
    'cloudflare_zone_not_found',
    404,
    '站点不存在'
  )

  // ---- 3. 隧道令牌：签发取回、无效响应、轮换 ----
  let tokenPath = ''
  let rotateSecret = ''
  const tokenResults: unknown[] = ['tok-1', { token: 'tok-2' }, {}]
  CloudflareClient.prototype.get = async function (requestPath: string): Promise<unknown> {
    tokenPath = requestPath
    return { result: tokenResults.shift() }
  }
  CloudflareClient.prototype.patch = async function (requestPath: string, body: unknown): Promise<unknown> {
    tokenPath = requestPath
    rotateSecret = String((body as Record<string, unknown>).tunnel_secret ?? '')
    return { result: { id: 'tun-1' } }
  }

  assert.deepEqual(await tunnels.token('tun-1', 'tid-1'), { token: 'tok-1' }, '字符串令牌必须原样返回')
  assert.match(tokenPath, /\/tid-1\/token$/, '令牌必须从隧道 token 子资源读取')
  assert.deepEqual(await tunnels.token('tun-1', 'tid-1'), { token: 'tok-2' }, '对象形状的令牌必须被识别')
  await rejectsCode(() => tunnels.token('tun-1', 'tid-1'), 'cloudflared_tunnel_token_invalid', 502, '空令牌响应')

  tokenResults.push('tok-rotated')
  assert.deepEqual(await tunnels.rotateToken('tun-1', 'tid-1'), { token: 'tok-rotated' }, '轮换后必须返回新令牌')
  assert.ok(rotateSecret.length > 0, '轮换必须先写回新的 tunnel_secret')
  const firstSecret = rotateSecret
  tokenResults.push('tok-rotated-2')
  await tunnels.rotateToken('tun-1', 'tid-1')
  assert.notEqual(rotateSecret, firstSecret, '每次轮换都必须重新生成 tunnel_secret')

  await rejectsCode(
    () => tunnels.token('tun-unlinked', 'tid-1'),
    'cloudflared_cloudflare_provider_missing',
    422,
    '隧道服务商未关联 Cloudflare'
  )
  await rejectsCode(
    () => tunnels.token('tun-no-account', 'tid-1'),
    'cloudflared_account_id_required',
    422,
    '关联的 Cloudflare 缺 account_id'
  )

  // ---- 4. 同步配置归一化：目标切换必须换掉旧服务商，非法组合回退已存配置 ----
  const stored = {
    hostname: 'www.example.com',
    sync_target: 'dnspod',
    sync_provider_id: 'dns-1',
    sync_zone: 'example.com',
    auto_preferred: true,
  }
  assert.deepEqual(
    await syncConfig.normalizeSyncPreference('saas-1', 'www.example.com', stored, {
      sync_target: '',
      sync_provider_id: '',
    }),
    { sync_target: '', sync_provider_id: '', sync_zone: '', auto_preferred: true },
    '显式清空 target/provider 表示关闭自动同步，但不得丢掉已有优选开关'
  )
  const switched = await syncConfig.normalizeSyncPreference('saas-1', 'www.example.com', stored, {
    sync_target: 'cloudflare_dns',
  })
  assert.equal(switched.sync_target, 'cloudflare_dns')
  assert.equal(switched.sync_provider_id, 'cf-dns-1', '目标切换后不得沿用旧目标的 DNSPod 服务商')
  assert.equal(switched.auto_preferred, true, '未提交的开关沿用已存配置')

  const dirty = await syncConfig.normalizeSyncPreference(
    'saas-1',
    'www.example.com',
    {
      hostname: 'www.example.com',
      sync_target: 'cloudflare_dns',
      sync_provider_id: 'cf-dns-1',
      sync_zone: 'other.com',
      auto_preferred: false,
    },
    {}
  )
  assert.deepEqual(
    dirty,
    { sync_target: 'dnspod', sync_provider_id: 'dns-1', sync_zone: 'example.com', auto_preferred: false },
    'Cloudflare 站点不覆盖主机名时必须回退到默认目标并重算站点'
  )
  assert.equal(
    await syncConfig.defaultSyncTarget('saas-cf-only'),
    'cloudflare_dns',
    '只有 Cloudflare 关联时默认走 CF DNS'
  )
  assert.equal(await syncConfig.defaultSyncTarget('saas-unlinked'), '', '无任何关联服务商时没有默认目标')
  assert.equal(await syncConfig.cloudflareProviderId('saas-1'), 'cf-1')

  // ---- 5. 优选域名合并口径：本地偏好 → 顶层 → custom_metadata ----
  // 顶层与 custom_metadata 同时存在且不同时，远端侧必须取顶层：前端与派生记录都按顶层优先读取
  const bothRemote = { id: 'h1', hostname: 'www.example.com', preferred_domain: 'top.example.net' }
  const withMetadata = { ...bothRemote, custom_metadata: { preferred_domain: 'meta.example.net' } }
  const localPreference = {
    hostname: 'www.example.com',
    hostname_id: 'h1',
    preferred_domain: 'local.example.net',
    sync_target: '',
    sync_provider_id: '',
    sync_zone: '',
    auto_preferred: false,
    ownership_txt_cleaned: false,
  }
  assert.equal(
    effectivePreferredDomain(withMetadata, localPreference),
    'local.example.net',
    '本地偏好优先于远端的两个字段'
  )
  assert.equal(
    effectivePreferredDomain(withMetadata, null),
    'top.example.net',
    '无本地偏好时顶层优先于 custom_metadata'
  )
  const merged = syncConfig.mergePreference(withMetadata, localPreference)
  assert.equal(merged.preferred_domain, 'local.example.net', '合并后的顶层即最终值')
  assert.equal(merged.custom_metadata?.preferred_domain, 'local.example.net', '合并结果的 custom_metadata 必须同值')
  assert.equal(
    syncConfig.mergePreference(withMetadata, null).preferred_domain,
    effectivePreferredDomain(withMetadata, null),
    '合并写入侧与共用取值函数必须同口径'
  )
  // 派生记录（DNS 写回）读的就是同一份合并结果：两端不得给出不同优选域名
  const cfRecords = saasDesiredRecords({
    hostname: merged,
    providerType: 'cloudflare',
    providerId: 'cf-dns-1',
    zone: 'example.com',
    origin: 'origin.example.net',
  })
  assert.equal(
    cfRecords.find((record) => record.purpose === 'origin_cname')?.record.value,
    merged.preferred_domain,
    'DNS 写回目标必须等于读接口给出的优选域名'
  )

  await rejectsCode(
    () => syncConfig.cloudflareProviderId('saas-unlinked'),
    'saas_cloudflare_provider_missing',
    422,
    'SaaS 未关联 Cloudflare'
  )
  await rejectsCode(() => syncConfig.cloudflareProviderId('nope'), 'saas_provider_not_found', 404, 'SaaS 不存在')

  console.log(
    'saas-config-branch-probe=ok preferred=normalized/symmetry id-by-name=real-chain sync-config=target-switch tunnel=token/rotate'
  )
} finally {
  await fs.rm(dataDir, { recursive: true, force: true })
}
