import { describe, expect, it } from 'vitest'
import { ApiError } from '../../../core/http/api-error.js'
import type { CloudflareZonePort } from '../../../core/contracts/cloudflare-zone.port.js'
import type { DnsZoneCatalogPort } from '../../../core/contracts/dns-zone-catalog.port.js'
import type { LinkedDnsAccountPort } from '../../../core/contracts/linked-dns-account.port.js'
import type { SaaSHostnameValue } from '../../../core/contracts/saas-hostname.port.js'
import type { SaaSSyncDefaultsPort } from '../../../core/contracts/saas-sync-config.port.js'
import type { ProviderRepository } from '../../../core/providers/provider.repository.js'
import {
  optionalDnsPodSaasTarget,
  resolveCloudflareSaasTarget,
  resolveDnsPodSaasTarget,
  resolveEffectiveOrigin,
  resolveSaaSSyncTarget,
  saasDefaultCloudflareProviderId,
  saasDnsPodProviderId,
  type SaaSPlannerDeps,
  type SaaSPlannerHostnames,
} from './saas-targets.planner.js'

/**
 * SaaS 同步目标解析（§4.2 planner 的目标侧）。
 *
 * 这里的每条分支都服务写入路径与 repair：写错一条，同一台主机名的「同步」与「修复」就会分叉。
 * 因此断言落在三件事上——值域（显式 > 同步配置 > 服务商默认）、归属门禁（站点必须托管该主机名），
 * 以及失败语义（未关联 → 422；站点待定 → ok:false 跳过；其它错误一律上抛）。
 */

type SyncConfig = Awaited<ReturnType<SaaSPlannerHostnames['syncConfig']>>
type EffectiveSyncConfig = Awaited<ReturnType<SaaSPlannerHostnames['effectiveSyncConfig']>>

const explicitSyncConfig = (overrides: Partial<SyncConfig> = {}): SyncConfig => ({
  hostname: 'www.example.com',
  sync_target: '',
  sync_provider_id: '',
  sync_zone: '',
  auto_preferred: false,
  ...overrides,
})

const effectiveSyncConfig = (overrides: Partial<SyncConfig> = {}): EffectiveSyncConfig => ({
  ...explicitSyncConfig(overrides),
  explicit: false,
})

const hostname = (overrides: Partial<SaaSHostnameValue> = {}): SaaSHostnameValue => ({
  id: 'h-1',
  hostname: 'www.example.com',
  ...overrides,
})

type DepsOptions = {
  syncConfig?: (providerId: string, fqdn: string) => SyncConfig
  effective?: (providerId: string, fqdn: string, cfZone: string) => EffectiveSyncConfig
  linked?: (providerId: string) => string
  fallbackOrigin?: (providerId: string, zone: string) => string | null
  owns?: (host: { zone: string; fqdn: string }) => boolean
  defaultSyncProviderId?: (providerId: string, target: string) => string
  idByName?: (providerId: string, zoneName: string) => string
  requireExplicit?: (providerId: string, zone: string) => string
  resolve?: (providerId: string, fqdn: string) => string
}

/** 站点是否托管主机名：与 saas-hostname-rules 的 zoneOwnsHostname 同义（同名或为其子域） */
function zoneOwns(host: { zone: string; fqdn: string }): boolean {
  const zone = host.zone.trim().toLowerCase().replace(/\.$/, '')
  const fqdn = host.fqdn.trim().toLowerCase().replace(/\.$/, '')
  return zone !== '' && (fqdn === zone || fqdn.endsWith(`.${zone}`))
}

/** 端口桩：所有调用按序记入 calls；未覆盖的端口方法不会被 planner 触碰 */
function plannerDeps(options: DepsOptions = {}): { deps: SaaSPlannerDeps; calls: string[] } {
  const calls: string[] = []
  const hostnames = {
    syncConfig: async (providerId: string, fqdn: string, zoneName?: string) => {
      calls.push(`syncConfig:${providerId}:${fqdn}:${zoneName ?? ''}`)
      return options.syncConfig?.(providerId, fqdn) ?? explicitSyncConfig()
    },
    effectiveSyncConfig: async (providerId: string, fqdn: string, zoneName?: string) => {
      calls.push(`effectiveSyncConfig:${providerId}:${fqdn}:${zoneName ?? ''}`)
      return options.effective?.(providerId, fqdn, zoneName ?? '') ?? effectiveSyncConfig()
    },
    fallbackOrigin: async (providerId: string, zoneName: string) => {
      calls.push(`fallbackOrigin:${providerId}:${zoneName}`)
      return options.fallbackOrigin?.(providerId, zoneName) ?? null
    },
    zoneOwnsHostname: (host: { zone: string; fqdn: string }) => {
      calls.push(`zoneOwnsHostname:${host.zone}:${host.fqdn}`)
      return options.owns ? options.owns(host) : zoneOwns(host)
    },
  }
  const access = {
    linkedProviderId: async (providerId: string, source: string, label: string) => {
      calls.push(`linkedProviderId:${providerId}:${source}:${label}`)
      return options.linked?.(providerId) ?? ''
    },
  }
  const catalog = {
    resolve: async (providerId: string, fqdn: string, prefix: string) => {
      calls.push(`catalog.resolve:${providerId}:${fqdn}:${prefix}`)
      return options.resolve?.(providerId, fqdn) ?? 'example.com'
    },
    requireExplicit: async (providerId: string, zone: string, prefix: string) => {
      calls.push(`catalog.requireExplicit:${providerId}:${zone}:${prefix}`)
      return options.requireExplicit?.(providerId, zone) ?? zone
    },
  }
  const syncDefaults = {
    defaultSyncProviderId: async (providerId: string, target: string) => {
      calls.push(`defaultSyncProviderId:${providerId}:${target}`)
      return options.defaultSyncProviderId?.(providerId, target) ?? 'cf-default'
    },
  }
  const cloudflareZones = {
    idByName: async (providerId: string, zoneName: string) => {
      calls.push(`idByName:${providerId}:${zoneName}`)
      return options.idByName?.(providerId, zoneName) ?? `zone-id:${zoneName}`
    },
  }
  const deps: SaaSPlannerDeps = {
    hostnames: hostnames as unknown as SaaSPlannerHostnames,
    access: access as unknown as LinkedDnsAccountPort,
    catalog: catalog as unknown as DnsZoneCatalogPort,
    syncDefaults: syncDefaults as unknown as SaaSSyncDefaultsPort,
    cloudflareZones: cloudflareZones as unknown as CloudflareZonePort,
    providers: {} as unknown as ProviderRepository,
  }
  return { deps, calls }
}

/** 捕获 rejection，供「具体错误码」与「原样上抛」类断言使用 */
async function captured(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  throw new Error('预期拒绝但未拒绝')
}

describe('resolveEffectiveOrigin：主机名自定义回源优先，否则站点默认回源', () => {
  it('自定义回源去除首尾空白，且不再读站点默认回源', async () => {
    const { deps, calls } = plannerDeps({ fallbackOrigin: () => 'fallback.example.com' })
    const origin = await resolveEffectiveOrigin(
      deps.hostnames,
      'saas-1',
      'example.com',
      hostname({ custom_origin_server: '  custom.example.com  ' })
    )

    expect(origin).toBe('custom.example.com')
    expect(calls).toEqual([])
  })

  it('自定义回源缺失 / null / 全空白时回退站点默认回源', async () => {
    const { deps, calls } = plannerDeps({ fallbackOrigin: () => 'fallback.example.com' })
    const values = [hostname(), hostname({ custom_origin_server: null }), hostname({ custom_origin_server: '   ' })]

    for (const value of values) {
      expect(await resolveEffectiveOrigin(deps.hostnames, 'saas-1', 'example.com', value)).toBe('fallback.example.com')
    }
    expect(calls).toEqual([
      'fallbackOrigin:saas-1:example.com',
      'fallbackOrigin:saas-1:example.com',
      'fallbackOrigin:saas-1:example.com',
    ])
  })

  it('站点未设置默认回源（null）时归一为空串', async () => {
    const { deps } = plannerDeps({ fallbackOrigin: () => null })
    expect(await resolveEffectiveOrigin(deps.hostnames, 'saas-1', 'example.com', hostname())).toBe('')
  })
})

describe('saasDnsPodProviderId：主机名声明优先，其次 SaaS 关联账号', () => {
  it('主机名声明的同步服务商去空白后优先，不读关联账号', async () => {
    const { deps, calls } = plannerDeps({ linked: () => 'dp-linked' })
    expect(await saasDnsPodProviderId(deps, 'saas-1', hostname({ sync_provider_id: '  dp-host  ' }))).toBe('dp-host')
    expect(calls).toEqual([])
  })

  it('主机名未声明（缺失或全空白）时读 SaaS 关联的 DNSPod 服务商', async () => {
    const { deps, calls } = plannerDeps({ linked: () => 'dp-linked' })

    expect(await saasDnsPodProviderId(deps, 'saas-1', hostname())).toBe('dp-linked')
    expect(await saasDnsPodProviderId(deps, 'saas-1', hostname({ sync_provider_id: '   ' }))).toBe('dp-linked')
    expect(calls).toEqual(['linkedProviderId:saas-1:saas:SaaS', 'linkedProviderId:saas-1:saas:SaaS'])
  })

  it('未关联返回空串（由调用方决定跳过还是报错）', async () => {
    const { deps } = plannerDeps({ linked: () => '' })
    expect(await saasDnsPodProviderId(deps, 'saas-1', hostname())).toBe('')
  })
})

describe('saasDefaultCloudflareProviderId：只读服务商默认值', () => {
  it('按 cloudflare_dns 目标取默认服务商', async () => {
    const { deps, calls } = plannerDeps({ defaultSyncProviderId: () => 'cf-dns-1' })

    expect(await saasDefaultCloudflareProviderId(deps, 'saas-1')).toBe('cf-dns-1')
    expect(calls).toEqual(['defaultSyncProviderId:saas-1:cloudflare_dns'])
  })

  it('默认未关联时抛 422 saas_cloudflare_dns_provider_missing', async () => {
    const { deps } = plannerDeps({ defaultSyncProviderId: () => '' })
    const error = await captured(() => saasDefaultCloudflareProviderId(deps, 'saas-1'))

    expect(error).toMatchObject({
      code: 'saas_cloudflare_dns_provider_missing',
      statusCode: 422,
      message: 'SaaS provider is not linked to a Cloudflare DNS provider',
    })
  })
})

describe('resolveDnsPodSaasTarget：显式优先，显式站点失效时回退权威匹配', () => {
  it('显式站点与服务商优先，且不再读主机名同步配置', async () => {
    const { deps, calls } = plannerDeps({ requireExplicit: (_providerId, zone) => `canonical:${zone}` })
    const target = await resolveDnsPodSaasTarget(
      deps,
      'saas-1',
      hostname({ sync_provider_id: 'dp-host' }),
      'www.example.com',
      '  Example.COM  ',
      '  dp-explicit '
    )

    expect(target).toEqual({ providerType: 'dnspod', providerId: 'dp-explicit', zone: 'canonical:Example.COM' })
    expect(calls).toEqual(['catalog.requireExplicit:dp-explicit:Example.COM:saas'])
  })

  it('主机名尚未创建（null）时按 SaaS 关联账号解析服务商，站点取主机名同步配置', async () => {
    const { deps, calls } = plannerDeps({
      linked: () => 'dp-linked',
      syncConfig: () => explicitSyncConfig({ sync_zone: 'example.com' }),
    })
    const target = await resolveDnsPodSaasTarget(deps, 'saas-1', null, 'www.example.com')

    expect(target).toEqual({ providerType: 'dnspod', providerId: 'dp-linked', zone: 'example.com' })
    expect(calls).toEqual([
      'linkedProviderId:saas-1:saas:SaaS',
      'syncConfig:saas-1:www.example.com:',
      'catalog.requireExplicit:dp-linked:example.com:saas',
    ])
  })

  it('未关联 DNSPod 时抛 422，且不解析站点', async () => {
    const { deps, calls } = plannerDeps({ linked: () => '' })
    const error = await captured(() => resolveDnsPodSaasTarget(deps, 'saas-1', null, 'www.example.com'))

    expect(error).toMatchObject({
      code: 'saas_dnspod_provider_missing',
      statusCode: 422,
      message: 'SaaS provider is not linked to a DNSPod provider',
    })
    expect(calls).toEqual(['linkedProviderId:saas-1:saas:SaaS'])
  })

  it('显式站点在账号内不存在（saas_dnspod_zone_not_found）时改用最长后缀匹配', async () => {
    const { deps, calls } = plannerDeps({
      requireExplicit: () => {
        throw new ApiError('saas_dnspod_zone_not_found', 'DNSPod zone not found', 422)
      },
      resolve: () => 'example.co.uk',
    })
    const target = await resolveDnsPodSaasTarget(
      deps,
      'saas-1',
      hostname({ sync_provider_id: 'dp-1' }),
      'www.example.co.uk',
      'example.co.uk'
    )

    expect(target).toEqual({ providerType: 'dnspod', providerId: 'dp-1', zone: 'example.co.uk' })
    expect(calls).toEqual([
      'catalog.requireExplicit:dp-1:example.co.uk:saas',
      'catalog.resolve:dp-1:www.example.co.uk:saas',
    ])
  })

  it('显式站点解析的其它错误原样上抛，不回退（避免把上游故障换成另一个站点）', async () => {
    const failure = new ApiError('saas_dnspod_provider_not_found', 'DNSPod provider not found', 404)
    const { deps, calls } = plannerDeps({
      requireExplicit: () => {
        throw failure
      },
    })

    await expect(
      resolveDnsPodSaasTarget(deps, 'saas-1', hostname({ sync_provider_id: 'dp-1' }), 'www.example.com', 'example.com')
    ).rejects.toBe(failure)
    expect(calls.filter((call) => call.startsWith('catalog.resolve:'))).toEqual([])
  })

  it('未声明同步站点（空串）时直接走最长后缀匹配', async () => {
    const { deps, calls } = plannerDeps({ resolve: () => 'example.com' })
    const target = await resolveDnsPodSaasTarget(
      deps,
      'saas-1',
      hostname({ sync_provider_id: 'dp-1' }),
      'a.example.com'
    )

    expect(target).toEqual({ providerType: 'dnspod', providerId: 'dp-1', zone: 'example.com' })
    expect(calls).toEqual(['syncConfig:saas-1:a.example.com:', 'catalog.resolve:dp-1:a.example.com:saas'])
  })
  it('同步站点带首尾空白时先归一，不拿带空格的站点名去 requireExplicit', async () => {
    // 空白串是 truthy：不 trim 会穿过下面的「空则退回后缀匹配」判定，
    // 拿 '  example.com  ' 去打一次必然失败的上游查询，再回退——白跑一趟
    const { deps, calls } = plannerDeps({
      syncConfig: () => explicitSyncConfig({ sync_provider_id: 'dp-1', sync_zone: '  example.com  ' }),
    })
    const target = await resolveDnsPodSaasTarget(
      deps,
      'saas-1',
      hostname({ sync_provider_id: 'dp-1' }),
      'www.example.com'
    )

    expect(target).toEqual({ providerType: 'dnspod', providerId: 'dp-1', zone: 'example.com' })
    expect(calls).toContain('catalog.requireExplicit:dp-1:example.com:saas')
  })
})

describe('optionalDnsPodSaasTarget：失败以 ok:false 显式标记，不与成功目标混用同一形状', () => {
  it('未关联 DNSPod 时返回 dnspod_provider_missing，不抛错', async () => {
    const { deps, calls } = plannerDeps({ linked: () => '' })

    expect(await optionalDnsPodSaasTarget(deps, 'saas-1', hostname(), 'www.example.com')).toEqual({
      ok: false,
      reason: 'dnspod_provider_missing',
    })
    expect(calls).toEqual(['linkedProviderId:saas-1:saas:SaaS'])
  })

  it('成功时在完整目标上补 ok:true', async () => {
    const { deps, calls } = plannerDeps({ syncConfig: () => explicitSyncConfig({ sync_zone: 'example.com' }) })

    expect(
      await optionalDnsPodSaasTarget(deps, 'saas-1', hostname({ sync_provider_id: 'dp-1' }), 'www.example.com')
    ).toEqual({ providerType: 'dnspod', providerId: 'dp-1', zone: 'example.com', ok: true })
    expect(calls).toEqual(['syncConfig:saas-1:www.example.com:', 'catalog.requireExplicit:dp-1:example.com:saas'])
  })

  it('站点解析未命中时降级为 dnspod_zone_not_found', async () => {
    const notFound = new ApiError('saas_dnspod_zone_not_found', 'DNSPod zone not found', 422)
    const { deps } = plannerDeps({
      syncConfig: () => explicitSyncConfig({ sync_zone: 'example.com' }),
      requireExplicit: () => {
        throw notFound
      },
      resolve: () => {
        throw notFound
      },
    })

    expect(
      await optionalDnsPodSaasTarget(deps, 'saas-1', hostname({ sync_provider_id: 'dp-1' }), 'www.example.com')
    ).toEqual({ ok: false, reason: 'dnspod_zone_not_found' })
  })

  it('其它错误原样上抛（不降级成跳过）', async () => {
    const failure = new ApiError('saas_dnspod_zone_lookup_failed', 'lookup failed', 502)
    const { deps } = plannerDeps({
      syncConfig: () => explicitSyncConfig({ sync_zone: 'example.com' }),
      requireExplicit: () => {
        throw failure
      },
    })

    await expect(
      optionalDnsPodSaasTarget(deps, 'saas-1', hostname({ sync_provider_id: 'dp-1' }), 'www.example.com')
    ).rejects.toBe(failure)
  })
})

describe('resolveCloudflareSaasTarget：站点必须托管主机名', () => {
  it('显式站点与服务商优先：站点名小写化后用于归属判定与站点 ID 解析', async () => {
    const { deps, calls } = plannerDeps({ syncConfig: () => explicitSyncConfig({ sync_zone: 'other.example' }) })
    const target = await resolveCloudflareSaasTarget(deps, 'saas-1', 'WWW.Example.COM.', {
      zone: '  Example.COM ',
      provider: ' cf-explicit ',
    })

    expect(target).toEqual({
      providerType: 'cloudflare',
      providerId: 'cf-explicit',
      zone: 'example.com',
      zoneId: 'zone-id:example.com',
    })
    expect(calls).toEqual([
      'syncConfig:saas-1:WWW.Example.COM.:',
      'zoneOwnsHostname:example.com:WWW.Example.COM.',
      'zoneOwnsHostname:example.com:www.example.com',
      'idByName:cf-explicit:example.com',
    ])
  })

  it('同步站点带首尾空白时归一后再做归属判定与站点 ID 解析', async () => {
    // zoneOwnsHostname 内部会 normalizeFqdn，所以归属判定不受空白影响；
    // 但 zoneName 会作为返回值传出去写进解析记录，必须在源头归一
    const { deps, calls } = plannerDeps({
      syncConfig: () => explicitSyncConfig({ sync_zone: '  Example.COM  ', sync_provider_id: 'cf-sync' }),
    })
    const target = await resolveCloudflareSaasTarget(deps, 'saas-1', 'www.example.com')

    expect(target).toEqual({
      providerType: 'cloudflare',
      providerId: 'cf-sync',
      zone: 'example.com',
      zoneId: 'zone-id:example.com',
    })
    expect(calls).toContain('idByName:cf-sync:example.com')
  })

  it('未显式指定时取主机名同步配置的站点与服务商，不读服务商默认值', async () => {
    const { deps, calls } = plannerDeps({
      syncConfig: () => explicitSyncConfig({ sync_zone: 'Example.COM', sync_provider_id: 'cf-sync' }),
    })
    const target = await resolveCloudflareSaasTarget(deps, 'saas-1', 'www.example.com')

    expect(target).toEqual({
      providerType: 'cloudflare',
      providerId: 'cf-sync',
      zone: 'example.com',
      zoneId: 'zone-id:example.com',
    })
    expect(calls).toEqual([
      'syncConfig:saas-1:www.example.com:',
      'zoneOwnsHostname:example.com:www.example.com',
      'zoneOwnsHostname:example.com:www.example.com',
      'idByName:cf-sync:example.com',
    ])
  })

  it('两处都没有服务商时取 SaaS 默认 Cloudflare DNS 服务商', async () => {
    const { deps, calls } = plannerDeps({
      syncConfig: () => explicitSyncConfig({ sync_zone: 'example.com' }),
      defaultSyncProviderId: () => 'cf-default',
    })
    const target = await resolveCloudflareSaasTarget(deps, 'saas-1', 'www.example.com')

    expect(target.providerId).toBe('cf-default')
    expect(calls).toEqual([
      'syncConfig:saas-1:www.example.com:',
      'defaultSyncProviderId:saas-1:cloudflare_dns',
      'zoneOwnsHostname:example.com:www.example.com',
      'zoneOwnsHostname:example.com:www.example.com',
      'idByName:cf-default:example.com',
    ])
  })

  it('显式 provider 为空白时视为未指定，回退同步配置或默认值', async () => {
    const { deps } = plannerDeps({
      syncConfig: () => explicitSyncConfig({ sync_zone: 'example.com' }),
      defaultSyncProviderId: () => 'cf-default',
    })
    const target = await resolveCloudflareSaasTarget(deps, 'saas-1', 'www.example.com', { provider: '   ' })

    expect(target.providerId).toBe('cf-default')
  })

  it('默认服务商也未关联时抛 422 saas_cloudflare_dns_provider_missing', async () => {
    const { deps, calls } = plannerDeps({
      syncConfig: () => explicitSyncConfig({ sync_zone: 'example.com' }),
      defaultSyncProviderId: () => '',
    })
    const error = await captured(() => resolveCloudflareSaasTarget(deps, 'saas-1', 'www.example.com'))

    expect(error).toMatchObject({ code: 'saas_cloudflare_dns_provider_missing', statusCode: 422 })
    expect(calls.filter((call) => call.startsWith('idByName:'))).toEqual([])
  })

  it('同步站点不托管主机名时丢弃并回退到主机名所在站点（cfZoneName）', async () => {
    const { deps, calls } = plannerDeps({
      syncConfig: () => explicitSyncConfig({ sync_zone: 'wrong.example', sync_provider_id: 'cf-sync' }),
    })
    const target = await resolveCloudflareSaasTarget(deps, 'saas-1', 'www.example.com', {
      cfZoneName: ' Example.COM. ',
    })

    expect(target.zone).toBe('example.com')
    expect(calls).toEqual([
      'syncConfig:saas-1:www.example.com:',
      'zoneOwnsHostname:wrong.example:www.example.com',
      'zoneOwnsHostname:example.com:www.example.com',
      'idByName:cf-sync:example.com',
    ])
  })

  it('同步站点缺失且无回退站点时抛 422 saas_cloudflare_sync_zone_missing', async () => {
    const { deps, calls } = plannerDeps({ defaultSyncProviderId: () => 'cf-default' })
    const error = await captured(() => resolveCloudflareSaasTarget(deps, 'saas-1', 'www.example.com'))

    expect(error).toMatchObject({ code: 'saas_cloudflare_sync_zone_missing', statusCode: 422 })
    expect(calls).toEqual(['syncConfig:saas-1:www.example.com:', 'defaultSyncProviderId:saas-1:cloudflare_dns'])
  })

  it('最终站点不托管主机名时抛 422 saas_cloudflare_sync_zone_mismatch，并带主机名与站点', async () => {
    const { deps, calls } = plannerDeps({ syncConfig: () => explicitSyncConfig({ sync_zone: 'other.example' }) })
    const error = await captured(() =>
      resolveCloudflareSaasTarget(deps, 'saas-1', 'www.example.com', { cfZoneName: 'other.example' })
    )

    expect(error).toMatchObject({
      code: 'saas_cloudflare_sync_zone_mismatch',
      statusCode: 422,
      details: { hostname: 'www.example.com', sync_zone: 'other.example' },
    })
    expect(calls.filter((call) => call.startsWith('idByName:'))).toEqual([])
  })

  it('skipHostnameConfig 时不读主机名同步配置，只用显式站点', async () => {
    const { deps, calls } = plannerDeps({ syncConfig: () => explicitSyncConfig({ sync_zone: 'never.example' }) })
    const target = await resolveCloudflareSaasTarget(deps, 'saas-1', 'www.example.com', {
      skipHostnameConfig: true,
      zone: 'example.com',
      provider: 'cf-x',
      cfZoneName: 'ignored.example',
    })

    expect(target).toEqual({
      providerType: 'cloudflare',
      providerId: 'cf-x',
      zone: 'example.com',
      zoneId: 'zone-id:example.com',
    })
    expect(calls).toEqual([
      'zoneOwnsHostname:example.com:www.example.com',
      'zoneOwnsHostname:example.com:www.example.com',
      'idByName:cf-x:example.com',
    ])
  })
})

describe('resolveSaaSSyncTarget：按主机名生效配置分流两条目标解析', () => {
  it('cloudflare_dns：解析 Cloudflare 目标并压成站点级目标（不暴露 zoneId）', async () => {
    const { deps, calls } = plannerDeps({
      effective: () =>
        effectiveSyncConfig({ sync_target: 'cloudflare_dns', sync_zone: 'example.com', sync_provider_id: 'cf-9' }),
    })
    const target = await resolveSaaSSyncTarget(deps, 'saas-1', hostname(), 'www.example.com', 'example.com')

    expect(target).toEqual({ providerType: 'cloudflare', providerId: 'cf-9', zone: 'example.com' })
    expect(calls).toEqual([
      'effectiveSyncConfig:saas-1:www.example.com:example.com',
      'syncConfig:saas-1:www.example.com:',
      'zoneOwnsHostname:example.com:www.example.com',
      'zoneOwnsHostname:example.com:www.example.com',
      'idByName:cf-9:example.com',
    ])
  })

  it('dnspod：走 DNSPod 目标解析，不读 Cloudflare 默认值', async () => {
    const { deps, calls } = plannerDeps({
      effective: () =>
        effectiveSyncConfig({ sync_target: 'dnspod', sync_zone: 'example.com', sync_provider_id: 'dp-9' }),
    })
    const target = await resolveSaaSSyncTarget(
      deps,
      'saas-1',
      hostname({ sync_provider_id: 'dp-9' }),
      'www.example.com',
      'example.com'
    )

    expect(target).toEqual({ providerType: 'dnspod', providerId: 'dp-9', zone: 'example.com' })
    expect(calls).toEqual([
      'effectiveSyncConfig:saas-1:www.example.com:example.com',
      'catalog.requireExplicit:dp-9:example.com:saas',
    ])
  })

  it('空目标（未配置）与 dnspod 同路径', async () => {
    const { deps, calls } = plannerDeps({
      effective: () => effectiveSyncConfig({ sync_target: '', sync_provider_id: 'dp-9' }),
    })
    const target = await resolveSaaSSyncTarget(
      deps,
      'saas-1',
      hostname({ sync_provider_id: 'dp-9' }),
      'www.example.com',
      'example.com'
    )

    expect(target).toEqual({ providerType: 'dnspod', providerId: 'dp-9', zone: 'example.com' })
    expect(calls).toEqual([
      'effectiveSyncConfig:saas-1:www.example.com:example.com',
      'syncConfig:saas-1:www.example.com:',
      'catalog.resolve:dp-9:www.example.com:saas',
    ])
  })

  it('未知同步目标抛 422 saas_sync_target_invalid（不静默回落 DNSPod）', async () => {
    const { deps, calls } = plannerDeps({
      effective: () => effectiveSyncConfig({ sync_target: 'route53' as never }),
    })
    const error = await captured(() =>
      resolveSaaSSyncTarget(deps, 'saas-1', hostname(), 'www.example.com', 'example.com')
    )

    expect(error).toMatchObject({
      code: 'saas_sync_target_invalid',
      statusCode: 422,
      message: 'Unsupported SaaS sync target: route53',
      details: { sync_target: 'route53' },
    })
    expect(calls).toEqual(['effectiveSyncConfig:saas-1:www.example.com:example.com'])
  })
})
