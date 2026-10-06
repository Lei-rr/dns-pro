import { describe, expect, it } from 'vitest'
import { ApiError } from '../../core/http/api-error.js'
import type { DnsRecordPort } from '../../core/contracts/dns-record.port.js'
import { cloudflareRecordPort } from '../../modules/cloudflare/dns/cloudflare-record.adapter.js'
import { DnsWriter } from '../derived-records/dns-writer.js'
import { cloudflareDnsCleanupRecipe } from '../derived-records/planners/saas.planner.js'
import { CloudflareDnsSaaSSyncAdapter } from './cloudflare-dns-saas-sync.adapter.js'
import { DnsPodSaaSSyncAdapter } from './dns-pod-saas-sync.adapter.js'
import { SaaSDnsSyncWorkflow } from './saas-dns-sync.workflow.js'

/**
 * SaaS 同步适配器与写入口的对齐行为：
 * - 站点解析的临时故障必须上抛原文，只有「域名未匹配到账号」才降级为空 zone 快照（否则真实故障被静默吞掉）；
 * - 更新重试必须复用更新前的 DNS 快照，不得重新采集（重采到的是更新后的状态，旧记录会漏删）；
 * - 删除清理只动有归属证据的记录，人工记录一律保留。
 */

const recipeHostnames = {
  showHostname: async () => ({
    hostname: 'www.example.com',
    sync_provider_id: 'dns-target',
    custom_origin_server: 'origin.example.net',
    status: 'pending',
    ssl: {},
  }),
  syncConfig: async () => ({ sync_zone: '' }),
  fallbackOrigin: async () => null,
}

describe('DnsPodSaaSSyncAdapter.collectRecordsFor', () => {
  it('临时故障上抛原文，域名未匹配时降级为空 zone 快照', async () => {
    let zoneError: ApiError = new ApiError('dnspod_request_failed', 'temporary network failure', 502)
    const catalog = {
      resolve: async () => {
        throw zoneError
      },
    }
    const access = { linkedProviderId: async () => 'dns-target' }
    const adapter = new DnsPodSaaSSyncAdapter(recipeHostnames as never, access as never, catalog as never, {} as never)

    const temporary = await adapter.collectRecordsFor('saas-owner', 'example.com', 'www.example.com').then(
      () => null,
      (error: unknown) => error
    )
    expect(temporary).toBe(zoneError)

    zoneError = new ApiError('saas_dnspod_zone_not_found', 'zone missing', 404)
    const missingZone = await adapter.collectRecordsFor('saas-owner', 'example.com', 'www.example.com')
    // 域名没匹配到不是失败：返回空快照，避免清理配方携带无归属目标
    expect(missingZone).toEqual({ hostname_fqdn: 'www.example.com', records: [] })
  })
})

describe('SaaSDnsSyncWorkflow.updateHostname：重试复用更新前快照', () => {
  it('已完成阶段不重新采集，resync 拿到更新前的 DNS 快照', async () => {
    const oldPreferredRecords = [
      { type: 'CNAME', name: 'www.example.com', value: 'old-preferred.example.net', purpose: 'preferred_cname' },
    ]
    let collectCalls = 0
    let resyncBeforeRecords: unknown[] = []
    const hostnames = {
      resolveZoneRef: async () => ({ cloudflareProviderId: 'cf-owner', zoneId: 'zone-1' }),
      updateHostname: async () => ({ id: 'host-1', hostname: 'www.example.com' }),
      invalidateHostnameAndList: () => undefined,
    }
    const sync = {
      collect: async () => {
        collectCalls++
        return { hostname_fqdn: 'www.example.com', records: [] }
      },
      resync: async (_provider: string, _zone: string, _hostname: string, records: unknown[]) => {
        resyncBeforeRecords = records
        return { status: 'completed', records: [] }
      },
    }
    const workflow = new SaaSDnsSyncWorkflow(hostnames as never, {} as never, sync as never)

    await workflow.updateHostname('saas-owner', 'example.com', 'www.example.com', { auto_preferred: false }, true, {
      completed: ['before-records-saved', 'remote-applied'],
      beforeRecords: oldPreferredRecords,
    } as never)

    expect(collectCalls).toBe(0)
    expect(resyncBeforeRecords).toEqual(oldPreferredRecords)
  })
})

describe('CloudflareDnsSaaSSyncAdapter.cleanup：只清理有归属证据的记录', () => {
  it('人工记录（无备注）保留，本流程写入的记录被删除', async () => {
    let deletes = 0
    // 人工记录（无备注）归属不明：即使同名同类型也不得删除
    const manualRecord = {
      id: 'CNAME:www.example.com',
      name: 'www.example.com',
      type: 'CNAME',
      content: 'old.target.example.net',
      comment: '',
    }
    // 本流程写入的记录：备注可证明归属，应被清理
    const ownedRecord = {
      id: 'TXT:_cf-custom-hostname.www.example.com',
      name: '_cf-custom-hostname.www.example.com',
      type: 'TXT',
      content: 'verify-token',
      comment: '所有权验证丨www.example.com',
    }
    const cfZone = { idByName: async () => 'dns-zone-1' }
    const cfRecords = {
      findExact: async (_provider: string, _zone: string, name: string, type: string) =>
        [manualRecord, ownedRecord].filter((row) => row.name === name && row.type === type),
      delete: async () => {
        deletes++
        return { id: String(deletes) }
      },
    }
    // 本用例只走 Cloudflare 端口：DNSPod 槽位补全闭合联合（Record<DnsProviderType, DnsRecordPort>）即可，
    // 一旦被触达即用例失效，显式抛错而不是静默兜底
    const unusedDnsPodPort: DnsRecordPort = {
      find: async () => [],
      create: async () => {
        throw new Error('cleanup 用例不应创建 DNSPod 记录')
      },
      update: async () => {
        throw new Error('cleanup 用例不应更新 DNSPod 记录')
      },
      remove: async () => {
        throw new Error('cleanup 用例不应删除 DNSPod 记录')
      },
    }
    const writer = new DnsWriter(
      { cloudflare: cloudflareRecordPort(cfZone as never, cfRecords as never), dnspod: unusedDnsPodPort },
      {
        claimsFor: async () => [],
      }
    )
    const adapter = new CloudflareDnsSaaSSyncAdapter({} as never, {} as never, cfZone as never, writer)

    const result = await adapter.cleanup(
      'saas-owner',
      'www.example.com',
      cloudflareDnsCleanupRecipe('www.example.com', 'cf-dns', 'example.com')
    )

    expect(result.cleaned).toBe(1)
    expect(deletes).toBe(1)
  })
})
