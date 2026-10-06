import { describe, expect, it } from 'vitest'
import { ApiError } from '../../../core/http/api-error.js'
import type { Provider, ProviderType } from '../../../core/providers/provider.types.js'
import { edgeOneCnameDesired, edgeOneDerivedPlanner } from './edge-one.planner.js'

/**
 * EdgeOne 加速域名 → 期望 DNS 记录（§4.2 planner）。
 *
 * 扫描里每一个 continue 都对应一类「不产生派生目标」的输入（非 EdgeOne 服务商 / 未关联 DNSPod /
 * 站点缺 ID / 域名空名 / 未分配 CNAME / 已不在关联账号内），它们必须静默跳过；
 * 而除「加速域名已不存在」之外的任何上游故障都必须上抛——
 * 上游故障被显示成「无漂移」会让真实漂移永远无法收敛。
 */

type PlannerDeps = Parameters<typeof edgeOneDerivedPlanner>[0]

type ZoneFixture = { id: string; name: string }
type DomainFixture = { name: string }

const provider = (type: ProviderType, id: string, extra: Record<string, unknown> = {}): Provider =>
  ({ type, id, name: id, ...extra }) as unknown as Provider

/**
 * 上游桩：所有调用按发生顺序记入 calls，用于断言遍历顺序、参数归一与「短路后不再触碰下游」。
 * 默认值只服务 happy path；异常分支一律由用例显式注入。
 */
function plannerDeps(options: {
  providers: Provider[]
  zones?: Record<string, ZoneFixture[]>
  domains?: Record<string, DomainFixture[]>
  assigned?: (providerId: string, zoneId: string, fqdn: string) => Promise<string>
  resolve?: (providerId: string, fqdn: string, prefix: string) => Promise<string>
}): { deps: PlannerDeps; calls: string[] } {
  const calls: string[] = []
  const deps: PlannerDeps = {
    providers: {
      all: async () => {
        calls.push('providers.all')
        return options.providers
      },
    } as unknown as PlannerDeps['providers'],
    zones: {
      zones: async (providerId: string) => {
        calls.push(`zones:${providerId}`)
        return { items: options.zones?.[providerId] ?? [] }
      },
    } as unknown as PlannerDeps['zones'],
    domains: {
      accelerationDomains: async (providerId: string, zoneId: string) => {
        calls.push(`domains:${providerId}:${zoneId}`)
        return { items: options.domains?.[`${providerId}:${zoneId}`] ?? [] }
      },
      assignedCname: async (providerId: string, zoneId: string, fqdn: string) => {
        calls.push(`cname:${providerId}:${zoneId}:${fqdn}`)
        if (!options.assigned) return `cname-${fqdn}.edgeone.site`
        return options.assigned(providerId, zoneId, fqdn)
      },
    } as unknown as PlannerDeps['domains'],
    catalog: {
      resolve: async (providerId: string, fqdn: string, prefix: string) => {
        calls.push(`resolve:${providerId}:${fqdn}:${prefix}`)
        if (!options.resolve) return 'example.com'
        return options.resolve(providerId, fqdn, prefix)
      },
    } as unknown as PlannerDeps['catalog'],
  }
  return { deps, calls }
}

/** 标准输入：一个已关联 DNSPod 的 EdgeOne 服务商 + 一个站点 + 一个加速域名 */
function standardDeps(
  overrides: {
    providers?: Provider[]
    zones?: Record<string, ZoneFixture[]>
    domains?: Record<string, DomainFixture[]>
    assigned?: (providerId: string, zoneId: string, fqdn: string) => Promise<string>
    resolve?: (providerId: string, fqdn: string, prefix: string) => Promise<string>
  } = {}
): { deps: PlannerDeps; calls: string[] } {
  return plannerDeps({
    providers: overrides.providers ?? [provider('edgeone', 'eo-1', { dnspod_provider: 'dnsp-1' })],
    zones: overrides.zones ?? { 'eo-1': [{ id: 'zone-1', name: 'example.com' }] },
    domains: overrides.domains ?? { 'eo-1:zone-1': [{ name: 'www.example.com' }] },
    assigned: overrides.assigned,
    resolve: overrides.resolve,
  })
}

/** 捕获 rejection，供「原样上抛」类断言使用 */
async function captured(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  throw new Error('预期拒绝但未拒绝')
}

describe('edgeOneCnameDesired：同步写入与对账检测共用的期望记录', () => {
  it('字段取固定字面量：CNAME + DNSPod 默认线路 + 600s + 备注带主机名', () => {
    expect(edgeOneCnameDesired('www.example.com', 'www.example.com.edgeone.site')).toEqual({
      purpose: 'edgeone_cname',
      fqdn: 'www.example.com',
      owner: 'edgeone',
      refId: 'www.example.com',
      record: {
        type: 'CNAME',
        value: 'www.example.com.edgeone.site',
        line: '默认',
        note: 'EdgeOne 加速丨www.example.com',
        ttl: 600,
      },
    })
  })

  it('fqdn 同时进入 refId 与备注，cname 只进入值', () => {
    const desired = edgeOneCnameDesired('a.b.example.net', 'target.edgeone.site')
    expect(desired.refId).toBe('a.b.example.net')
    expect(desired.record.note).toBe('EdgeOne 加速丨a.b.example.net')
    expect(desired.record.value).toBe('target.edgeone.site')
  })
})

describe('扫描正常路径：服务商 → 站点 → 加速域名 → CNAME → DNSPod 目标', () => {
  it('产出完整 PlannedRecord，并按顺序读上游', async () => {
    const { deps, calls } = standardDeps()
    const records = await edgeOneDerivedPlanner(deps).scan({})

    expect(records).toEqual([
      {
        source: { kind: 'edgeone-domain', providerId: 'eo-1', id: 'www.example.com' },
        target: { providerType: 'dnspod', providerId: 'dnsp-1', zone: 'example.com', fqdn: 'www.example.com' },
        owner: 'edgeone',
        purpose: 'edgeone_cname',
        desired: {
          purpose: 'edgeone_cname',
          fqdn: 'www.example.com',
          owner: 'edgeone',
          refId: 'www.example.com',
          record: {
            type: 'CNAME',
            value: 'cname-www.example.com.edgeone.site',
            line: '默认',
            note: 'EdgeOne 加速丨www.example.com',
            ttl: 600,
          },
        },
      },
    ])
    expect(calls).toEqual([
      'providers.all',
      'zones:eo-1',
      'domains:eo-1:zone-1',
      'cname:eo-1:zone-1:www.example.com',
      'resolve:dnsp-1:www.example.com:edgeone',
    ])
  })

  it('加速域名先归一（大小写与尾点），归一值用于 CNAME 查询、来源标识与目标 FQDN', async () => {
    const { deps, calls } = standardDeps({ domains: { 'eo-1:zone-1': [{ name: '  WWW.Example.COM.  ' }] } })
    const records = await edgeOneDerivedPlanner(deps).scan({})

    expect(records.map((record) => record.source.id)).toEqual(['www.example.com'])
    expect(records.map((record) => record.target.fqdn)).toEqual(['www.example.com'])
    expect(records.map((record) => record.desired.record.value)).toEqual(['cname-www.example.com.edgeone.site'])
    expect(calls).toEqual([
      'providers.all',
      'zones:eo-1',
      'domains:eo-1:zone-1',
      'cname:eo-1:zone-1:www.example.com',
      'resolve:dnsp-1:www.example.com:edgeone',
    ])
  })

  it('多服务商 × 多站点 × 多域名按声明顺序展开', async () => {
    const { deps } = plannerDeps({
      providers: [
        provider('edgeone', 'eo-1', { dnspod_provider: 'dnsp-1' }),
        provider('edgeone', 'eo-2', { dnspod_provider: 'dnsp-2' }),
      ],
      zones: {
        'eo-1': [
          { id: 'z1', name: 'a.example' },
          { id: 'z2', name: 'b.example' },
        ],
        'eo-2': [{ id: 'z3', name: 'c.example' }],
      },
      domains: {
        'eo-1:z1': [{ name: 'one.a.example' }, { name: 'two.a.example' }],
        'eo-1:z2': [{ name: 'one.b.example' }],
        'eo-2:z3': [{ name: 'one.c.example' }],
      },
      resolve: async (providerId) => (providerId === 'dnsp-1' ? 'a.example' : 'c.example'),
    })
    const records = await edgeOneDerivedPlanner(deps).scan({})

    expect(records.map((record) => `${record.source.providerId}/${record.target.zone}/${record.source.id}`)).toEqual([
      'eo-1/a.example/one.a.example',
      'eo-1/a.example/two.a.example',
      'eo-1/a.example/one.b.example',
      'eo-2/c.example/one.c.example',
    ])
  })
})

describe('扫描过滤：不产生派生目标的输入静默跳过，不报错', () => {
  it('非 EdgeOne 服务商整条跳过，不读站点', async () => {
    const { deps, calls } = plannerDeps({
      providers: [
        provider('dnspod', 'dp-0'),
        provider('cloudflare', 'cf-0'),
        provider('saas', 'saas-0'),
        provider('cloudflared', 'tunnel-0'),
        provider('edgeone', 'eo-1', { dnspod_provider: 'dnsp-1' }),
      ],
      zones: { 'eo-1': [{ id: 'zone-1', name: 'example.com' }] },
      domains: { 'eo-1:zone-1': [{ name: 'www.example.com' }] },
    })
    const records = await edgeOneDerivedPlanner(deps).scan({})

    expect(records.map((record) => record.source.providerId)).toEqual(['eo-1'])
    expect(calls.filter((call) => call.startsWith('zones:'))).toEqual(['zones:eo-1'])
  })

  it('dnspod_provider 为空串或字段缺失时跳过，不读站点', async () => {
    const { deps, calls } = plannerDeps({
      providers: [provider('edgeone', 'eo-empty', { dnspod_provider: '' }), provider('edgeone', 'eo-missing')],
    })
    const records = await edgeOneDerivedPlanner(deps).scan({})

    expect(records).toEqual([])
    expect(calls).toEqual(['providers.all'])
  })

  it('scope.providerId 命中服务商自身或关联 DNSPod 时扫描，其它值跳过', async () => {
    const { deps, calls } = standardDeps()
    const planner = edgeOneDerivedPlanner(deps)

    expect((await planner.scan({ providerId: 'eo-1' })).map((record) => record.source.id)).toEqual(['www.example.com'])
    expect((await planner.scan({ providerId: 'dnsp-1' })).map((record) => record.source.id)).toEqual([
      'www.example.com',
    ])
    expect(await planner.scan({ providerId: 'saas-1' })).toEqual([])

    expect(calls.filter((call) => call.startsWith('zones:'))).toEqual(['zones:eo-1', 'zones:eo-1'])
    expect(calls.filter((call) => call.startsWith('cname:'))).toHaveLength(2)
  })

  it('站点缺 ID 时跳过该站点，继续处理后续站点', async () => {
    const { deps, calls } = standardDeps({
      zones: {
        'eo-1': [
          { id: '', name: 'broken.example' },
          { id: 'zone-2', name: 'example.com' },
        ],
      },
      domains: { 'eo-1:zone-2': [{ name: 'www.example.com' }] },
    })
    const records = await edgeOneDerivedPlanner(deps).scan({})

    expect(records.map((record) => record.source.id)).toEqual(['www.example.com'])
    expect(calls.filter((call) => call.startsWith('domains:'))).toEqual(['domains:eo-1:zone-2'])
  })

  it('加速域名为空名或缺失时跳过，不发 CNAME 查询', async () => {
    const { deps, calls } = standardDeps({
      domains: { 'eo-1:zone-1': [{ name: '   ' }, { name: '' }, { name: 'ok.example.com' }] },
    })
    const records = await edgeOneDerivedPlanner(deps).scan({})

    expect(records.map((record) => record.source.id)).toEqual(['ok.example.com'])
    expect(calls.filter((call) => call.startsWith('cname:'))).toEqual(['cname:eo-1:zone-1:ok.example.com'])
  })

  it('未分配 CNAME（空串）跳过，不解析 DNSPod 站点', async () => {
    const { deps, calls } = standardDeps({ assigned: async () => '' })
    const records = await edgeOneDerivedPlanner(deps).scan({})

    expect(records).toEqual([])
    expect(calls.filter((call) => call.startsWith('resolve:'))).toEqual([])
  })

  it('DNSPod 站点解析返回空串时跳过（不产出半成品记录）', async () => {
    const { deps } = standardDeps({ resolve: async () => '' })
    const records = await edgeOneDerivedPlanner(deps).scan({})

    expect(records).toEqual([])
  })
})

describe('上游未命中：只吞显式 404，其余故障上抛', () => {
  it('CNAME 查询上游 404（upstream_status）视为加速域名已不存在，跳过', async () => {
    const missing = new ApiError('http_error', 'Provider API error: 404 Not Found', 400, { upstream_status: 404 })
    const { deps, calls } = standardDeps({
      assigned: async () => {
        throw missing
      },
    })
    const records = await edgeOneDerivedPlanner(deps).scan({})

    expect(records).toEqual([])
    expect(calls.filter((call) => call.startsWith('resolve:'))).toEqual([])
  })

  it('CNAME 查询业务码 edgeone_acceleration_domain_not_found 视为已不存在，跳过', async () => {
    const missing = new ApiError('edgeone_acceleration_domain_not_found', 'Acceleration domain not found', 404)
    const { deps, calls } = standardDeps({
      assigned: async () => {
        throw missing
      },
    })
    const records = await edgeOneDerivedPlanner(deps).scan({})

    expect(records).toEqual([])
    expect(calls.filter((call) => call.startsWith('resolve:'))).toEqual([])
  })

  it('CNAME 查询其它 ApiError 原样上抛（不被吞成无漂移）', async () => {
    const failure = new ApiError('http_error', 'Provider API error: 503', 502, { upstream_status: 503 })
    const { deps, calls } = standardDeps({
      assigned: async () => {
        throw failure
      },
    })

    await expect(edgeOneDerivedPlanner(deps).scan({})).rejects.toBe(failure)
    expect(calls.filter((call) => call.startsWith('resolve:'))).toEqual([])
  })

  it('CNAME 查询只有 error.statusCode=404、没有 upstream_status 且有自定义 code 时仍上抛', async () => {
    const failure = new ApiError('edgeone_domain_lookup_failed', 'lookup failed', 404)
    const { deps } = standardDeps({
      assigned: async () => {
        throw failure
      },
    })

    await expect(edgeOneDerivedPlanner(deps).scan({})).rejects.toBe(failure)
  })

  it('CNAME 查询抛出普通异常（非 ApiError）同样上抛', async () => {
    const failure = new Error('socket hang up')
    const { deps } = standardDeps({
      assigned: async () => {
        throw failure
      },
    })

    await expect(edgeOneDerivedPlanner(deps).scan({})).rejects.toBe(failure)
  })

  it('DNSPod 站点解析 404（加速域名不在关联账号内）跳过', async () => {
    const missing = new ApiError('http_error', 'Provider API error: 404 Not Found', 400, { upstream_status: '404' })
    const { deps } = standardDeps({
      resolve: async () => {
        throw missing
      },
    })
    const records = await edgeOneDerivedPlanner(deps).scan({})

    expect(records).toEqual([])
  })

  it('DNSPod 站点解析业务码 edgeone_dnspod_zone_not_found 跳过', async () => {
    const missing = new ApiError('edgeone_dnspod_zone_not_found', 'DNSPod zone not found', 422)
    const { deps } = standardDeps({
      resolve: async () => {
        throw missing
      },
    })
    const records = await edgeOneDerivedPlanner(deps).scan({})

    expect(records).toEqual([])
  })

  it('DNSPod 站点解析其它错误原样上抛（code 相近也不算未命中）', async () => {
    const failure = new ApiError('edgeone_dnspod_provider_not_found', 'DNSPod provider not found', 404)
    const { deps } = standardDeps({
      resolve: async () => {
        throw failure
      },
    })

    await expect(edgeOneDerivedPlanner(deps).scan({})).rejects.toBe(failure)
  })

  it('同一站点一条未命中一条命中时保持顺序且不中断', async () => {
    const { deps } = standardDeps({
      domains: { 'eo-1:zone-1': [{ name: 'gone.example.com' }, { name: 'ok.example.com' }] },
      assigned: async (_providerId, _zoneId, fqdn) => {
        if (fqdn === 'gone.example.com') {
          throw new ApiError('edgeone_acceleration_domain_not_found', 'Acceleration domain not found', 404)
        }
        return 'target.edgeone.site'
      },
    })
    const records = await edgeOneDerivedPlanner(deps).scan({})

    expect(records.map((record) => record.source.id)).toEqual(['ok.example.com'])
  })

  it('catalog 抛出的异常即使被 catch 包裹也不会被改成空结果', async () => {
    const failure = new Error('catalog exploded')
    const { deps } = standardDeps({
      resolve: async () => {
        throw failure
      },
    })

    const error = await captured(() => edgeOneDerivedPlanner(deps).scan({}))
    expect(error).toBe(failure)
  })
})
