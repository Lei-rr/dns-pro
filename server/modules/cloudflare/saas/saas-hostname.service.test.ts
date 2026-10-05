import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../core/http/api-error.js'
import { createSecretBox } from '../../../core/crypto/secret-box.js'
import { ProviderIntegrity } from '../../../core/providers/provider-integrity.js'
import { ProviderRepository } from '../../../core/providers/provider.repository.js'
import type { Provider } from '../../../core/providers/provider.types.js'
import { createStore } from '../../../core/store/store-registry.js'
import { SaaSHostnameService } from './saas-hostname.service.js'
import type { CustomHostnameIndex } from './saas-custom-hostname.client.js'
import { SaaSPreferenceService } from './saas-preference.service.js'
import { SaaSSyncConfigService } from './saas-sync-config.service.js'

/**
 * 删除的站点归属校验与更新的校验前置 / 偏好单事务：
 * 删除混入别的站点 FQDN 时绝不能清那站点的偏好、也绝不能报成功；
 * 更新时非法同步配置必须在写偏好与远端 PATCH 之前整体失败，而不是降级成 200 部分失败。
 * 多站点查找另有一组：每个站点只取一次快照，不因未命中而重复强制刷新。
 */

let dataRoot = ''

beforeEach(async () => {
  dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-pro-saas-host-'))
})

afterEach(async () => {
  await fs.rm(dataRoot, { recursive: true, force: true })
})

const preferencesPath = () => path.join(dataRoot, 'saas', 'preferences.json')

/** 读取偏好文件里实际落盘的行（文件不存在视为空表） */
async function preferenceRows(): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(preferencesPath(), 'utf8').catch(() => '{"items":{}}')
  return (JSON.parse(raw) as { items: Record<string, unknown> }).items
}

const seededProviders: Provider[] = [
  { type: 'cloudflare', id: 'cf-1', name: 'CF', api_token: 'token', account_id: 'acc' },
  { type: 'dnspod', id: 'dnspod-1', name: 'DNSPod', secret_id: 'sid', secret_key: 'skey' },
  { type: 'saas', id: 'saas-1', name: 'SaaS', cloudflare_provider: 'cf-1' },
]

/** 测试用的站点主机名快照：与 client 的 CustomHostnameIndex 同形，只做 FQDN → ID 查表 */
function indexOf(byFqdn: Record<string, string> = {}): CustomHostnameIndex {
  return { findId: (hostnameFqdn: string) => byFqdn[hostnameFqdn] }
}

async function createHarness(
  options: {
    idByHostname?: (
      cloudflareProviderId: string,
      zoneId: string,
      hostnameFqdn: string,
      refresh: boolean
    ) => Promise<string>
    current?: Record<string, unknown>
    zones?: Array<{ id: string; name: string }>
    hostnameIndex?: (cloudflareProviderId: string, zoneId: string, refresh?: boolean) => Promise<CustomHostnameIndex>
  } = {}
) {
  const providerStore = createStore('providers', dataRoot)
  await providerStore.write({ items: seededProviders })
  const providers = new ProviderRepository(providerStore, createSecretBox(Buffer.alloc(32, 7)))
  const prefStore = createStore('saasPreferences', dataRoot)
  const preferences = new SaaSPreferenceService(prefStore, new ProviderIntegrity(), providers)
  const syncConfigs = new SaaSSyncConfigService(providers, preferences)

  const current = options.current ?? {
    id: 'h-1',
    hostname: 'www.example.com',
    custom_origin_server: 'origin.example.com',
    status: 'active',
    ssl: {},
  }
  const defaultIdByHostname = options.idByHostname ?? (async () => 'h-1')
  const idByHostnameCalls: Array<{ zoneId: string; refresh: boolean }> = []
  const customHostnames = {
    idByHostname: async (cloudflareProviderId: string, zoneId: string, fqdn: string, refresh = false) => {
      idByHostnameCalls.push({ zoneId, refresh })
      return defaultIdByHostname(cloudflareProviderId, zoneId, fqdn, refresh)
    },
    hostnameIndex: options.hostnameIndex ?? (() => Promise.resolve(indexOf())),
    show: async () => current,
    update: vi.fn(async () => current),
    delete: vi.fn(async () => ({ id: 'h-1' })),
    listAll: async () => [current],
  }
  const zones = options.zones ?? [{ id: 'zone-1', name: 'example.com' }]
  const service = new SaaSHostnameService(
    {
      idByName: async () => 'zone-1',
      listAll: async () => ({ items: zones }),
    } as never,
    { dcvDelegationUuid: async () => '' } as never,
    customHostnames as never,
    {} as never,
    {
      normalize: (value: string) =>
        String(value ?? '')
          .trim()
          .toLowerCase(),
      isAllowed: async () => true,
    } as never,
    preferences,
    syncConfigs
  )
  return { service, preferences, prefStore, customHostnames, idByHostnameCalls }
}

describe('SaaS 主机名删除：站点归属校验', () => {
  it('站点不托管该 FQDN：整体失败，且同服务商下其它站点的偏好一行不动', async () => {
    const harness = await createHarness({
      idByHostname: async () => {
        throw new ApiError('saas_hostname_not_found', 'Hostname foo.other.com not found', 404)
      },
    })
    await harness.prefStore.write({
      items: {
        'cf-1:other.com:foo.other.com': {
          hostname: 'foo.other.com',
          hostname_id: 'h-other',
          preferred_domain: 'pref.example.com',
          sync_target: 'dnspod',
          sync_provider_id: 'dnspod-1',
          sync_zone: 'other.com',
          auto_preferred: true,
          ownership_txt_cleaned: true,
        },
        'cf-1::foo.other.com': { hostname: 'foo.other.com', preferred_domain: 'pref.example.com' },
      },
    })
    const before = await fs.readFile(preferencesPath(), 'utf8')

    const error = await harness.service.deleteHostname('saas-1', 'example.com', 'foo.other.com').then(
      () => null,
      (reason: unknown) => reason
    )
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'validation_failed', statusCode: 422 })
    expect(await fs.readFile(preferencesPath(), 'utf8')).toBe(before)
  })

  it('站点托管该 FQDN 而远端已不存在：清掉该主机名偏好并返回空 id（幂等删除）', async () => {
    const harness = await createHarness({
      idByHostname: async () => {
        throw new ApiError('saas_hostname_not_found', 'Hostname gone.example.com not found', 404)
      },
    })
    await harness.prefStore.write({
      items: {
        'cf-1:example.com:gone.example.com': { hostname: 'gone.example.com', preferred_domain: 'pref.example.com' },
        'cf-1::gone.example.com': { hostname: 'gone.example.com', sync_target: 'dnspod' },
        'cf-1:example.com:keep.example.com': { hostname: 'keep.example.com', preferred_domain: 'pref.example.com' },
      },
    })

    expect(await harness.service.deleteHostname('saas-1', 'example.com', 'gone.example.com')).toEqual({ id: '' })
    expect(Object.keys(await preferenceRows())).toEqual(['cf-1:example.com:keep.example.com'])
  })
})

describe('SaaS 主机名更新：校验前置与偏好单事务', () => {
  it('非法同步配置在写偏好与远端变更之前整体失败，不再降级成 200 部分失败', async () => {
    const harness = await createHarness()

    const error = await harness.service
      .updateHostname('saas-1', 'example.com', 'www.example.com', {
        preferred_domain: 'pref.example.com',
        custom_origin_server: 'new-origin.example.com',
        sync_target: 'dnspod',
        sync_provider_id: 'missing-dnspod',
      })
      .then(
        () => null,
        (reason: unknown) => reason
      )

    expect(error).toMatchObject({ code: 'provider_reference_not_found', statusCode: 422 })
    expect(harness.customHostnames.update).not.toHaveBeenCalled()
    expect(await preferenceRows()).toEqual({})
  })

  it('优选域名与同步配置在同一次偏好事务内落库', async () => {
    const harness = await createHarness()
    const transaction = vi.spyOn(harness.prefStore, 'transaction')

    await harness.service.updateHostname('saas-1', 'example.com', 'www.example.com', {
      preferred_domain: 'pref.example.com',
      sync_target: 'dnspod',
      sync_provider_id: 'dnspod-1',
    })

    // 修复前是 setPreferredDomain + setSyncConfig 两次事务：中间失败会留下半截偏好
    expect(transaction).toHaveBeenCalledTimes(1)
    const row = (await preferenceRows())['cf-1:example.com:www.example.com'] as Record<string, unknown>
    expect(row.preferred_domain).toBe('pref.example.com')
    expect(row.sync_target).toBe('dnspod')
    expect(row.sync_provider_id).toBe('dnspod-1')
    expect(row.sync_zone).toBe('example.com')
  })
})

describe('SaaS 多站点查找：每站点一次快照、命中即止', () => {
  it('归属站点先查且命中即止：不为前面站点的未命中强制刷新重拉', async () => {
    const calls: Array<{ cloudflareProviderId: string; zoneId: string; refresh: boolean }> = []
    const harness = await createHarness({
      zones: [
        { id: 'zone-other', name: 'other.com' },
        { id: 'zone-example', name: 'example.com' },
      ],
      hostnameIndex: async (cloudflareProviderId, zoneId, refresh) => {
        calls.push({ cloudflareProviderId, zoneId, refresh: refresh === true })
        return indexOf(zoneId === 'zone-example' ? { 'www.example.com': 'h-1' } : {})
      },
    })

    await harness.service.syncConfig('saas-1', 'www.example.com')

    // 归属站点直接命中：非归属站点一次都没问，更没有被逐个强制刷新
    expect(calls).toEqual([])
    expect(harness.idByHostnameCalls).toEqual([{ zoneId: 'zone-example', refresh: false }])
  })

  it('归属站点没有时：确认过再问其余站点，外部域名托管在非归属站点仍能找到', async () => {
    const calls: Array<{ cloudflareProviderId: string; zoneId: string; refresh: boolean }> = []
    const harness = await createHarness({
      zones: [
        { id: 'zone-example', name: 'example.com' },
        { id: 'zone-vendor', name: 'vendor.net' },
      ],
      idByHostname: async () => {
        throw new ApiError('saas_hostname_not_found', 'Hostname www.example.com not found', 404)
      },
      hostnameIndex: async (cloudflareProviderId, zoneId, refresh) => {
        calls.push({ cloudflareProviderId, zoneId, refresh: refresh === true })
        return indexOf(zoneId === 'zone-vendor' ? { 'www.example.com': 'h-vendor' } : {})
      },
    })

    await harness.service.syncConfig('saas-1', 'www.example.com')

    expect(harness.idByHostnameCalls).toEqual([{ zoneId: 'zone-example', refresh: false }])
    expect(calls).toEqual([{ cloudflareProviderId: 'cf-1', zoneId: 'zone-vendor', refresh: false }])
  })

  it('FQDN 不在任何站点：每个站点只取一次快照且全程不刷新，遍历完才 404', async () => {
    const calls: Array<{ cloudflareProviderId: string; zoneId: string; refresh: boolean }> = []
    const harness = await createHarness({
      zones: [
        { id: 'zone-1', name: 'example.com' },
        { id: 'zone-2', name: 'other.com' },
      ],
      hostnameIndex: async (cloudflareProviderId, zoneId, refresh) => {
        calls.push({ cloudflareProviderId, zoneId, refresh: refresh === true })
        return indexOf()
      },
    })

    const error = await harness.service.syncConfig('saas-1', 'missing.example.net').then(
      () => null,
      (reason: unknown) => reason
    )

    expect(error).toMatchObject({ code: 'saas_hostname_not_found', statusCode: 404 })
    expect(calls).toEqual([
      { cloudflareProviderId: 'cf-1', zoneId: 'zone-1', refresh: false },
      { cloudflareProviderId: 'cf-1', zoneId: 'zone-2', refresh: false },
    ])
  })
})
