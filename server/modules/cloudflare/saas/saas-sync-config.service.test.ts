import { describe, expect, it } from 'vitest'
import { ApiError } from '../../../core/http/api-error.js'
import { saasDesiredRecords } from '../../../workflows/derived-records/planners/saas.planner.js'
import { effectivePreferredDomain, isHostnameActive, zoneOwnsHostname } from './saas-hostname-rules.js'
import type { HostnamePreference } from './saas-preference.service.js'
import { SaaSSyncConfigService } from './saas-sync-config.service.js'

/**
 * 迁移自 scripts/isolated-saas-config-branch-probe.ts 第 4/5 节。
 *
 * 同步配置归一化：目标切换必须换掉旧目标的服务商（否则落成目标与类型不匹配的配置，写入时 422）；
 * 脏配置（Cloudflare 站点不覆盖主机名）必须回退默认目标并重算站点；
 * 优选域名的合并口径（本地偏好 → 顶层 → custom_metadata）必须与派生记录读到的同一份结果一致。
 */

const providerFixtures = new Map<string, Record<string, unknown>>([
  ['cf-1', { id: 'cf-1', type: 'cloudflare', name: 'CF', api_token: 'cf-token', account_id: 'acct-1' }],
  ['cf-dns-1', { id: 'cf-dns-1', type: 'cloudflare', name: 'CF DNS', api_token: 'cf-dns-token' }],
  ['dns-1', { id: 'dns-1', type: 'dnspod', name: 'DNSPod', secret_id: 'sid', secret_key: 'skey' }],
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

const syncConfig = new SaaSSyncConfigService(repository as never, {} as never)

/** 完整偏好行：normalizeSyncPreference 按行形状读取已存配置，缺字段会隐式变成空配置 */
function preference(overrides: Partial<HostnamePreference> = {}): HostnamePreference {
  return {
    hostname: '',
    hostname_id: '',
    preferred_domain: '',
    sync_target: '',
    sync_provider_id: '',
    sync_zone: '',
    auto_preferred: false,
    ownership_txt_cleaned: false,
    ...overrides,
  }
}

describe('SaaS 同步配置归一化：目标切换与脏配置修复', () => {
  const stored = preference({
    hostname: 'www.example.com',
    sync_target: 'dnspod',
    sync_provider_id: 'dns-1',
    sync_zone: 'example.com',
    auto_preferred: true,
  })

  it('显式清空 target/provider 表示关闭自动同步，但不得丢掉已有优选开关', async () => {
    await expect(
      syncConfig.normalizeSyncPreference('saas-1', 'www.example.com', stored, {
        sync_target: '',
        sync_provider_id: '',
      })
    ).resolves.toEqual({ sync_target: '', sync_provider_id: '', sync_zone: '', auto_preferred: true })
  })

  it('目标切换后不得沿用旧目标的 DNSPod 服务商，未提交的开关沿用已存配置', async () => {
    const switched = await syncConfig.normalizeSyncPreference('saas-1', 'www.example.com', stored, {
      sync_target: 'cloudflare_dns',
    })
    expect(switched.sync_target).toBe('cloudflare_dns')
    expect(switched.sync_provider_id).toBe('cf-dns-1')
    expect(switched.auto_preferred).toBe(true)
  })

  it('Cloudflare 站点不覆盖主机名时必须回退到默认目标并重算站点', async () => {
    const dirty = await syncConfig.normalizeSyncPreference(
      'saas-1',
      'www.example.com',
      preference({
        hostname: 'www.example.com',
        sync_target: 'cloudflare_dns',
        sync_provider_id: 'cf-dns-1',
        sync_zone: 'other.com',
        auto_preferred: false,
      }),
      {}
    )
    expect(dirty).toEqual({
      sync_target: 'dnspod',
      sync_provider_id: 'dns-1',
      sync_zone: 'example.com',
      auto_preferred: false,
    })
  })

  it('默认目标与 Cloudflare 关联解析：只有 Cloudflare 时走 CF DNS，无关联时没有默认目标', async () => {
    expect(await syncConfig.defaultSyncTarget('saas-cf-only')).toBe('cloudflare_dns')
    expect(await syncConfig.defaultSyncTarget('saas-unlinked')).toBe('')
    expect(await syncConfig.cloudflareProviderId('saas-1')).toBe('cf-1')
    await expect(syncConfig.cloudflareProviderId('saas-unlinked')).rejects.toMatchObject({
      code: 'saas_cloudflare_provider_missing',
      statusCode: 422,
    })
    await expect(syncConfig.cloudflareProviderId('nope')).rejects.toMatchObject({
      code: 'saas_provider_not_found',
      statusCode: 404,
    })
  })
})

describe('优选域名合并口径：本地偏好 → 顶层 → custom_metadata', () => {
  // 顶层与 custom_metadata 同时存在且不同时，远端侧必须取顶层：前端与派生记录都按顶层优先读取
  const bothRemote = { id: 'h1', hostname: 'www.example.com', preferred_domain: 'top.example.net' }
  const withMetadata = { ...bothRemote, custom_metadata: { preferred_domain: 'meta.example.net' } }
  const localPreference = preference({
    hostname: 'www.example.com',
    hostname_id: 'h1',
    preferred_domain: 'local.example.net',
  })

  it('取值顺序唯一：本地偏好优先于远端两个字段，无本地偏好时顶层优先于 custom_metadata', () => {
    expect(effectivePreferredDomain(withMetadata, localPreference)).toBe('local.example.net')
    expect(effectivePreferredDomain(withMetadata, null)).toBe('top.example.net')
  })

  it('合并结果的顶层即最终值，custom_metadata 必须同值', () => {
    const merged = syncConfig.mergePreference(withMetadata, localPreference)
    expect(merged.preferred_domain).toBe('local.example.net')
    expect(merged.custom_metadata?.preferred_domain).toBe('local.example.net')
    expect(syncConfig.mergePreference(withMetadata, null).preferred_domain).toBe(
      effectivePreferredDomain(withMetadata, null)
    )
  })

  it('DNS 写回目标必须等于读接口给出的优选域名', () => {
    // 派生记录（DNS 写回）读的就是同一份合并结果：两端不得给出不同优选域名
    const merged = syncConfig.mergePreference(withMetadata, localPreference)
    const cfRecords = saasDesiredRecords({
      hostname: merged,
      providerType: 'cloudflare',
      providerId: 'cf-dns-1',
      zone: 'example.com',
      origin: 'origin.example.net',
      rules: { effectivePreferredDomain, isHostnameActive, zoneOwnsHostname },
    })
    expect(cfRecords.find((record) => record.purpose === 'origin_cname')?.record.value).toBe(merged.preferred_domain)
  })
})
