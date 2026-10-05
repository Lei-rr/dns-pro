import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../core/http/api-error.js'
import { createSecretBox } from '../../../core/crypto/secret-box.js'
import { ProviderIntegrity } from '../../../core/providers/provider-integrity.js'
import { ProviderRepository, type ProvidersFile } from '../../../core/providers/provider.repository.js'
import type { Provider } from '../../../core/providers/provider.types.js'
import { createStore } from '../../../core/store/store-registry.js'
import { SaaSHostnameService } from './saas-hostname.service.js'
import { SaaSPreferenceService, type SaaSPreferencesFile } from './saas-preference.service.js'
import { SaaSSyncConfigService } from './saas-sync-config.service.js'

/**
 * 删除的站点归属校验与更新的校验前置 / 偏好单事务：
 * 删除混入别的站点 FQDN 时绝不能清那站点的偏好、也绝不能报成功；
 * 更新时非法同步配置必须在写偏好与远端 PATCH 之前整体失败，而不是降级成 200 部分失败。
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

async function createHarness(
  options: { idByHostname?: () => Promise<string>; current?: Record<string, unknown> } = {}
) {
  const providerStore = createStore<ProvidersFile>('providers', dataRoot)
  await providerStore.write({ items: seededProviders })
  const providers = new ProviderRepository(providerStore, createSecretBox(Buffer.alloc(32, 7)))
  const prefStore = createStore<SaaSPreferencesFile>('saasPreferences', dataRoot)
  const preferences = new SaaSPreferenceService(prefStore, new ProviderIntegrity(), providers)
  const syncConfigs = new SaaSSyncConfigService(providers, preferences)

  const current = options.current ?? {
    id: 'h-1',
    hostname: 'www.example.com',
    custom_origin_server: 'origin.example.com',
    status: 'active',
    ssl: {},
  }
  const customHostnames = {
    idByHostname: options.idByHostname ?? (async () => 'h-1'),
    show: async () => current,
    update: vi.fn(async () => current),
    delete: vi.fn(async () => ({ id: 'h-1' })),
    listAll: async () => [current],
  }
  const service = new SaaSHostnameService(
    {
      idByName: async () => 'zone-1',
      listAll: async () => ({ items: [{ id: 'zone-1', name: 'example.com' }] }),
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
  return { service, preferences, prefStore, customHostnames }
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
