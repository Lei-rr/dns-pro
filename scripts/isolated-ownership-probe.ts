/**
 * D4 所有权探针：
 *  1) 归属由派生关系解析（隧道路由 / SaaS 主机名 / EdgeOne 加速域名），不落盘；
 *  2) DnsWriter 门禁：manual 记录永不自动删、owner 不匹配拒绝删除、显式来源的清理仍可执行。
 * 无网络：派生关系与 DNS 端口全部用本地假实现。
 */
import assert from 'node:assert/strict'
import {
  normalizeOwnershipHost,
  ownerOf,
  ownershipConflict,
  type DerivedOwner,
  type OwnershipPort,
} from '../server/core/contracts/ownership.port.js'
import {
  OwnershipService,
  edgeOneOwnershipSource,
  saasOwnershipSource,
  tunnelOwnershipSource,
} from '../server/workflows/derived-records/ownership.js'
import { DnsWriter } from '../server/workflows/derived-records/dns-writer.js'
import type { DnsRecordPort, DnsRecordRef, DnsRecordValue } from '../server/core/contracts/dns-record.port.js'

const zone = 'example.com'

function row(id: string, name: string, value: string, note = ''): DnsRecordRef {
  return { id, value: { type: 'CNAME', name, value, line: '默认', note } }
}

// ---- 1) 纯查询：未声明即 manual -------------------------------------------------
{
  const claims = [{ fqdn: 'WWW.Example.com.', owner: 'saas' as const, refId: 'h1' }]
  assert.equal(normalizeOwnershipHost(' WWW.Example.com. '), 'www.example.com')
  assert.deepEqual(ownerOf(claims, 'www.example.com'), { owner: 'saas', refId: 'h1' })
  assert.deepEqual(ownerOf(claims, 'other.example.com'), { owner: 'manual', refId: '' })
  assert.equal(ownershipConflict(claims, 'www.example.com', 'saas'), null)
  assert.equal(ownershipConflict(claims, 'www.example.com', 'tunnel')?.refId, 'h1')
}

// ---- 2) 三来源解析：只认派生关系 -------------------------------------------------
{
  const providers = {
    all: async () => [
      { type: 'cloudflared', id: 'cfd-1', name: 'tunnel', cloudflare_provider: 'cf-1' },
      { type: 'saas', id: 'saas-1', name: 'saas', cloudflare_provider: 'cf-1', dnspod_provider: 'dp-1' },
      { type: 'edgeone', id: 'eo-1', name: 'edgeone', dnspod_provider: 'dp-1' },
    ],
  } as never

  const tunnels = {
    list: async () => ({ items: [{ id: 't-1', name: 't', status: 'inactive', connections: [] }] }),
  } as never
  const routes = {
    getConfig: async () => ({
      catch_all: 'http_status:404',
      version: 1,
      routes: [
        { hostname: 'app.example.com', service: 'http://127.0.0.1:8080', path: '' },
        { hostname: 'app.other.net', service: 'http://127.0.0.1:8080', path: '' },
      ],
    }),
  } as never
  const tunnelClaims = await tunnelOwnershipSource({
    providers,
    tunnels,
    routes,
  }).claimsFor({ providerType: 'cloudflare', providerId: 'cf-1', zone })
  assert.deepEqual(
    tunnelClaims.map((claim) => [claim.fqdn, claim.owner, claim.refId]),
    [['app.example.com', 'tunnel', 't-1']],
    `隧道路由只声明本站点主机名：${JSON.stringify(tunnelClaims)}`
  )

  const saasHostnames = {
    zones: async () => ({ items: [{ id: 'z1', name: zone }] }),
    hostnames: async () => ({
      items: [
        { id: 'h1', hostname: 'www.example.com', effective_sync_target: 'dnspod', effective_sync_provider_id: 'dp-1' },
        {
          id: 'h2',
          hostname: 'cf.example.com',
          effective_sync_target: 'cloudflare_dns',
          effective_sync_provider_id: 'cf-1',
        },
        {
          id: 'h3',
          hostname: 'elsewhere.example.com',
          effective_sync_target: 'dnspod',
          effective_sync_provider_id: 'dp-2',
        },
      ],
    }),
  } as never
  const saasDnspod = await saasOwnershipSource({ providers, hostnames: saasHostnames }).claimsFor({
    providerType: 'dnspod',
    providerId: 'dp-1',
    zone,
  })
  assert.deepEqual(
    saasDnspod.map((claim) => claim.fqdn).sort(),
    ['_acme-challenge.www.example.com', '_cf-custom-hostname.www.example.com', 'www.example.com'].sort(),
    `SaaS 主机名及 DCV/所有权记录同属 saas：${JSON.stringify(saasDnspod)}`
  )
  const saasCloudflare = await saasOwnershipSource({ providers, hostnames: saasHostnames }).claimsFor({
    providerType: 'cloudflare',
    providerId: 'cf-1',
    zone,
  })
  assert.deepEqual(
    saasCloudflare.map((claim) => claim.fqdn).sort(),
    ['_acme-challenge.cf.example.com', '_cf-custom-hostname.cf.example.com', 'cf.example.com'].sort()
  )

  const edgeOne = await edgeOneOwnershipSource({
    providers,
    zones: { zones: async () => ({ items: [{ id: 'eo-zone-1', name: zone }] }) } as never,
    domains: {
      accelerationDomains: async () => ({
        items: [
          { zone_id: 'eo-zone-1', name: 'eo.example.com' },
          { zone_id: 'eo-zone-1', name: 'eo.other.net' },
        ],
      }),
    } as never,
  }).claimsFor({ providerType: 'dnspod', providerId: 'dp-1', zone })
  assert.deepEqual(
    edgeOne.map((claim) => [claim.fqdn, claim.owner, claim.refId]),
    [['eo.example.com', 'edgeone', 'eo.example.com']]
  )

  // 合并：同一主机名多来源声明保留首个（来源顺序即优先级）
  const merged = await new OwnershipService([
    { claimsFor: async () => [{ fqdn: 'www.example.com', owner: 'tunnel', refId: 't-1' }] },
    { claimsFor: async () => [{ fqdn: 'www.example.com', owner: 'saas', refId: 'h1' }] },
  ]).claimsFor({ providerType: 'cloudflare', providerId: 'cf-1', zone })
  assert.deepEqual(merged, [{ fqdn: 'www.example.com', owner: 'tunnel', refId: 't-1' }])
}

// ---- 3) DnsWriter 门禁 -----------------------------------------------------------
function fakePort(rows: DnsRecordRef[]) {
  const removed: string[] = []
  const created: DnsRecordValue[] = []
  const port: DnsRecordPort = {
    find: async (_providerId, _zone, probe) =>
      rows.filter((ref) => ref.value.name === probe.name && (!probe.type || ref.value.type === probe.type)),
    create: async (_providerId, _zone, value: DnsRecordValue) => {
      created.push(value)
      return { id: `new-${created.length}`, value }
    },
    update: async (_providerId, _zone, recordId: string, value: DnsRecordValue) => ({ id: recordId, value }),
    remove: async (_providerId, _zone, recordId: string) => {
      removed.push(recordId)
    },
  }
  return { port, removed, created }
}

function lookup(claims: Array<{ fqdn: string; owner: DerivedOwner; refId: string }>): OwnershipPort {
  return { claimsFor: async () => claims }
}

// 3.1 manual 记录（无派生归属）+ 备注恰好匹配 → 未声明来源，拒绝自动删
{
  const { port, removed } = fakePort([row('r1', 'www', 'old.example.net', '业务接入丨www.example.com')])
  const writer = new DnsWriter({ dnspod: port }, lookup([]))
  const [outcome] = await writer.sync('dnspod', 'p1', zone, [
    {
      purpose: 'origin_cname',
      fqdn: 'www.example.com',
      owner: 'saas',
      keep: false,
      record: { type: 'CNAME', value: '', line: '默认', note: '业务接入丨www.example.com' },
    },
  ])
  assert.equal(outcome?.status, 'skipped', `manual 记录不得删除：${JSON.stringify(outcome)}`)
  assert.match(String(outcome?.error), /^unowned/)
  assert.deepEqual(removed, [], 'manual 记录仍被删除')
}

// 3.2 owner 不匹配 → 拒绝删除（即使备注可证明）
{
  const { port, removed } = fakePort([row('r2', 'tunnel', 'old.example.net', '业务接入丨tunnel.example.com')])
  const writer = new DnsWriter(
    { dnspod: port },
    lookup([{ fqdn: 'tunnel.example.com', owner: 'tunnel', refId: 't-1' }])
  )
  const [outcome] = await writer.sync('dnspod', 'p1', zone, [
    {
      purpose: 'origin_cname',
      fqdn: 'tunnel.example.com',
      owner: 'saas',
      refId: 'h1',
      keep: false,
      record: { type: 'CNAME', value: '', line: '默认', note: '业务接入丨tunnel.example.com' },
    },
  ])
  assert.equal(outcome?.status, 'skipped', `owner 不匹配必须拒绝：${JSON.stringify(outcome)}`)
  assert.match(String(outcome?.error), /^owner_mismatch/)
  assert.deepEqual(removed, [])
}

// 3.3 资源已删除的清理（关系消失）必须显式声明来源，才放行
{
  const { port, removed } = fakePort([row('r3', 'www', 'old.example.net', '业务接入丨www.example.com')])
  const writer = new DnsWriter({ dnspod: port }, lookup([]))
  const [outcome] = await writer.sync('dnspod', 'p1', zone, [
    {
      purpose: 'origin_cname',
      fqdn: 'www.example.com',
      owner: 'saas',
      refId: 'www.example.com',
      keep: false,
      record: { type: 'CNAME', value: '', line: '默认', note: '业务接入丨www.example.com' },
    },
  ])
  assert.equal(outcome?.status, 'deleted', `声明来源的清理应放行：${JSON.stringify(outcome)}`)
  assert.deepEqual(removed, ['r3'])
}

// 3.4 他人主机名：create/update 被拒，unchanged 不误报
{
  const claims = [{ fqdn: 'tunnel.example.com', owner: 'tunnel' as const, refId: 't-1' }]
  const created = fakePort([])
  const [createdOutcome] = await new DnsWriter({ dnspod: created.port }, lookup(claims)).sync('dnspod', 'p1', zone, [
    {
      purpose: 'origin_cname',
      fqdn: 'tunnel.example.com',
      owner: 'saas',
      refId: 'h1',
      record: { type: 'CNAME', value: 'origin.example.net', line: '默认', note: '业务接入丨tunnel.example.com' },
    },
  ])
  assert.equal(createdOutcome?.status, 'skipped', `不得夺取他人主机名：${JSON.stringify(createdOutcome)}`)
  assert.deepEqual(created.created, [])

  const exact = fakePort([
    {
      id: 'r4',
      value: {
        type: 'CNAME',
        name: 'tunnel',
        value: 'origin.example.net',
        line: '默认',
        note: '业务接入丨tunnel.example.com',
      },
    },
  ])
  const [unchanged] = await new DnsWriter({ dnspod: exact.port }, lookup(claims)).sync('dnspod', 'p1', zone, [
    {
      purpose: 'origin_cname',
      fqdn: 'tunnel.example.com',
      owner: 'saas',
      refId: 'h1',
      record: { type: 'CNAME', value: 'origin.example.net', line: '默认', note: '业务接入丨tunnel.example.com' },
    },
  ])
  assert.equal(unchanged?.status, 'unchanged', `无写入动作不校验失败：${JSON.stringify(unchanged)}`)
}

// 3.5 preclean：manual 主机名不清理，自己名下才清理
{
  const manual = fakePort([{ id: 'a1', value: { type: 'A', name: 'www', value: '192.0.2.9', line: '默认' } }])
  const manualOutcomes = await new DnsWriter({ dnspod: manual.port }, lookup([])).preclean(
    'dnspod',
    'p1',
    zone,
    { fqdn: 'www.example.com', type: 'CNAME' },
    'saas'
  )
  assert.equal(manualOutcomes[0]?.status, 'skipped', '无主主机名不得清理冲突记录')
  assert.deepEqual(manual.removed, [])

  const owned = fakePort([{ id: 'a2', value: { type: 'A', name: 'www', value: '192.0.2.9', line: '默认' } }])
  const ownedOutcomes = await new DnsWriter(
    { dnspod: owned.port },
    lookup([{ fqdn: 'www.example.com', owner: 'saas', refId: 'h1' }])
  ).preclean('dnspod', 'p1', zone, { fqdn: 'www.example.com', type: 'CNAME' }, 'saas')
  assert.equal(ownedOutcomes[0]?.status, 'deleted', `自己名下冲突记录应清理：${JSON.stringify(ownedOutcomes)}`)
  assert.deepEqual(owned.removed, ['a2'])
}

console.log('ownership-probe=ok sources=tunnel,saas,edgeone guards=manual,owner-mismatch,preclean')
