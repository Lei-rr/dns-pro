import { describe, expect, it } from 'vitest'
import type {
  DnsProviderType,
  DnsRecordPort,
  DnsRecordRef,
  DnsRecordValue,
} from '../../core/contracts/dns-record.port.js'
import {
  normalizeOwnershipHost,
  ownerOf,
  ownershipConflict,
  type DerivedOwner,
  type OwnershipPort,
} from '../../core/contracts/ownership.port.js'
import { DnsWriter } from './dns-writer.js'
import { zoneOwnsHostname } from '../../modules/cloudflare/saas/saas-hostname-rules.js'
import { edgeOneOwnershipSource, OwnershipService, saasOwnershipSource, tunnelOwnershipSource } from './ownership.js'

/** 站点归属规则注入真实实现：ownership 侧的判据必须与端口规则同源 */
const rules = { zoneOwnsHostname }

/**
 * 迁移自 scripts/isolated-ownership-probe.ts（P1：契约类）。
 * 派生关系与 DNS 端口全部用本地假实现，无网络。
 */

const zone = 'example.com'

function row(id: string, name: string, value: string, note = ''): DnsRecordRef {
  return { id, value: { type: 'CNAME', name, value, line: '默认', note } }
}

describe('归属查询：未声明即 manual', () => {
  const claims = [{ fqdn: 'WWW.Example.com.', owner: 'saas' as const, refId: 'h1' }]

  it('主机名归一：去空白、小写、去全部尾点', () => {
    expect(normalizeOwnershipHost(' WWW.Example.com. ')).toBe('www.example.com')
  })

  it('命中派生声明返回 owner/refId，未命中一律 manual', () => {
    expect(ownerOf(claims, 'www.example.com')).toEqual({ owner: 'saas', refId: 'h1' })
    expect(ownerOf(claims, 'other.example.com')).toEqual({ owner: 'manual', refId: '' })
  })

  it('冲突检测：同源放行，异源返回占用条目', () => {
    expect(ownershipConflict(claims, 'www.example.com', 'saas')).toBeNull()
    expect(ownershipConflict(claims, 'www.example.com', 'tunnel')?.refId).toBe('h1')
  })
})

describe('三来源解析：只认派生关系', () => {
  const providers = {
    all: async () => [
      { type: 'cloudflared', id: 'cfd-1', name: 'tunnel', cloudflare_provider: 'cf-1' },
      { type: 'saas', id: 'saas-1', name: 'saas', cloudflare_provider: 'cf-1', dnspod_provider: 'dp-1' },
      { type: 'edgeone', id: 'eo-1', name: 'edgeone', dnspod_provider: 'dp-1' },
    ],
  } as never

  it('隧道路由只声明本站点主机名', async () => {
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

    const tunnelClaims = await tunnelOwnershipSource({ providers, tunnels, routes, rules }).claimsFor({
      providerType: 'cloudflare',
      providerId: 'cf-1',
      zone,
    })
    expect(tunnelClaims.map((claim) => [claim.fqdn, claim.owner, claim.refId])).toEqual([
      ['app.example.com', 'tunnel', 't-1'],
    ])
  })

  it('SaaS 主机名连同 DCV / 所有权记录一并归属 saas，且按生效同步目标过滤', async () => {
    const hostnames = {
      zones: async () => ({ items: [{ id: 'z1', name: zone }] }),
      hostnames: async () => ({
        items: [
          {
            id: 'h1',
            hostname: 'www.example.com',
            effective_sync_target: 'dnspod',
            effective_sync_provider_id: 'dp-1',
          },
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

    const saasDnspod = await saasOwnershipSource({ providers, hostnames, rules }).claimsFor({
      providerType: 'dnspod',
      providerId: 'dp-1',
      zone,
    })
    expect(saasDnspod.map((claim) => claim.fqdn).sort()).toEqual(
      ['_acme-challenge.www.example.com', '_cf-custom-hostname.www.example.com', 'www.example.com'].sort()
    )

    const saasCloudflare = await saasOwnershipSource({ providers, hostnames, rules }).claimsFor({
      providerType: 'cloudflare',
      providerId: 'cf-1',
      zone,
    })
    expect(saasCloudflare.map((claim) => claim.fqdn).sort()).toEqual(
      ['_acme-challenge.cf.example.com', '_cf-custom-hostname.cf.example.com', 'cf.example.com'].sort()
    )
  })

  it('EdgeOne 加速域名声明 DNSPod 归属，站外域名不声明', async () => {
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
      rules,
    }).claimsFor({ providerType: 'dnspod', providerId: 'dp-1', zone })

    expect(edgeOne.map((claim) => [claim.fqdn, claim.owner, claim.refId])).toEqual([
      ['eo.example.com', 'edgeone', 'eo.example.com'],
    ])
  })

  it('合并多来源：同一主机名保留首个声明（注册顺序即优先级）', async () => {
    const merged = await new OwnershipService([
      { claimsFor: async () => [{ fqdn: 'www.example.com', owner: 'tunnel', refId: 't-1' }] },
      { claimsFor: async () => [{ fqdn: 'www.example.com', owner: 'saas', refId: 'h1' }] },
    ]).claimsFor({ providerType: 'cloudflare', providerId: 'cf-1', zone })
    expect(merged).toEqual([{ fqdn: 'www.example.com', owner: 'tunnel', refId: 't-1' }])
  })
})

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

/**
 * DnsWriter 的端口表按 DnsProviderType 要求全量：契约闭合后只传当前用例用到的厂商会编译失败。
 * 这些用例只走 dnspod 路径，cloudflare 槽位复用同一假实现即可（不会被调用）。
 */
function writerPorts(port: DnsRecordPort): Record<DnsProviderType, DnsRecordPort> {
  return { dnspod: port, cloudflare: port }
}

describe('DnsWriter 门禁', () => {
  it('manual 记录（无派生归属）+ 备注恰好匹配：未声明来源仍拒绝自动删', async () => {
    const { port, removed } = fakePort([row('r1', 'www', 'old.example.net', '业务接入丨www.example.com')])
    const writer = new DnsWriter(writerPorts(port), lookup([]))
    const [outcome] = await writer.sync('dnspod', 'p1', zone, [
      {
        purpose: 'origin_cname',
        fqdn: 'www.example.com',
        owner: 'saas',
        keep: false,
        record: { type: 'CNAME', value: '', line: '默认', note: '业务接入丨www.example.com' },
      },
    ])
    expect(outcome?.status).toBe('skipped')
    expect(String(outcome?.error)).toMatch(/^unowned/)
    expect(removed).toEqual([])
  })

  it('owner 不匹配：即使备注可证明归属也拒绝删除', async () => {
    const { port, removed } = fakePort([row('r2', 'tunnel', 'old.example.net', '业务接入丨tunnel.example.com')])
    const writer = new DnsWriter(
      writerPorts(port),
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
    expect(outcome?.status).toBe('skipped')
    expect(String(outcome?.error)).toMatch(/^owner_mismatch/)
    expect(removed).toEqual([])
  })

  it('资源已删除的清理：显式声明来源才放行', async () => {
    const { port, removed } = fakePort([row('r3', 'www', 'old.example.net', '业务接入丨www.example.com')])
    const writer = new DnsWriter(writerPorts(port), lookup([]))
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
    expect(outcome?.status).toBe('deleted')
    expect(removed).toEqual(['r3'])
  })

  it('他人主机名：create/update 被拒，unchanged 不误报', async () => {
    const claims = [{ fqdn: 'tunnel.example.com', owner: 'tunnel' as const, refId: 't-1' }]
    const created = fakePort([])
    const [createdOutcome] = await new DnsWriter(writerPorts(created.port), lookup(claims)).sync('dnspod', 'p1', zone, [
      {
        purpose: 'origin_cname',
        fqdn: 'tunnel.example.com',
        owner: 'saas',
        refId: 'h1',
        record: { type: 'CNAME', value: 'origin.example.net', line: '默认', note: '业务接入丨tunnel.example.com' },
      },
    ])
    expect(createdOutcome?.status).toBe('skipped')
    expect(created.created).toEqual([])

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
    const [unchanged] = await new DnsWriter(writerPorts(exact.port), lookup(claims)).sync('dnspod', 'p1', zone, [
      {
        purpose: 'origin_cname',
        fqdn: 'tunnel.example.com',
        owner: 'saas',
        refId: 'h1',
        record: { type: 'CNAME', value: 'origin.example.net', line: '默认', note: '业务接入丨tunnel.example.com' },
      },
    ])
    expect(unchanged?.status).toBe('unchanged')
  })

  it('preclean：manual 主机名不清理，自己名下才清理冲突记录', async () => {
    const manual = fakePort([{ id: 'a1', value: { type: 'A', name: 'www', value: '192.0.2.9', line: '默认' } }])
    const manualOutcomes = await new DnsWriter(writerPorts(manual.port), lookup([])).preclean(
      'dnspod',
      'p1',
      zone,
      { fqdn: 'www.example.com', type: 'CNAME' },
      'saas'
    )
    expect(manualOutcomes[0]?.status).toBe('skipped')
    expect(manual.removed).toEqual([])

    const owned = fakePort([{ id: 'a2', value: { type: 'A', name: 'www', value: '192.0.2.9', line: '默认' } }])
    const ownedOutcomes = await new DnsWriter(
      writerPorts(owned.port),
      lookup([{ fqdn: 'www.example.com', owner: 'saas', refId: 'h1' }])
    ).preclean('dnspod', 'p1', zone, { fqdn: 'www.example.com', type: 'CNAME' }, 'saas')
    expect(ownedOutcomes[0]?.status).toBe('deleted')
    expect(owned.removed).toEqual(['a2'])
  })
})
