import { describe, expect, it } from 'vitest'
import type { SaaSPreferencePort } from '../../core/contracts/saas-preference.port.js'
import type { ProviderRepository } from '../../core/providers/provider.repository.js'
import { ProviderDependencyWorkflow } from './provider-dependency.workflow.js'

/**
 * 依赖反查的索引容器必须是无原型对象。
 *
 * provider id 是任意合法字符串，历史数据里可能存在 constructor / toString 这类命中
 * Object.prototype 的名字：普通对象字面量在 `map[id] ??= []` 处读到的是原型链上的函数，
 * 非空值让 `??=` 不建数组，紧跟的 push 直接抛错（服务商列表 500）；
 * forProvider 也会把函数当成依赖数组交给删除保护逻辑。
 *
 * 输入侧（provider-normalizer 的保留 ID）已拒绝新建这类 id，这里守住读路径：存量脏数据不得让接口崩。
 */

function build(providers: Array<Record<string, unknown>>, preferences: Record<string, unknown> = {}) {
  const repository = { all: async () => providers } as unknown as ProviderRepository
  const hostnamePreferences = { listAll: async () => preferences } as unknown as SaaSPreferencePort
  return new ProviderDependencyWorkflow(repository, hostnamePreferences)
}

function preferenceRow(overrides: Record<string, unknown> = {}) {
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

describe('服务商依赖反查：索引容器与原型链隔离', () => {
  it('被引用方 id 命中 Object.prototype 名字时仍能建索引，不得抛错', async () => {
    const workflow = build([
      { id: 'saas', name: 'SaaS', type: 'saas', cloudflare_provider: 'constructor' },
      { id: 'constructor', name: '存量脏 id', type: 'cloudflare' },
    ])

    const map = await workflow.map()

    expect(map['constructor']).toHaveLength(1)
    expect(map['constructor']?.[0]).toMatchObject({ kind: 'provider', type: 'saas', id: 'saas' })
    expect(await workflow.forProvider('constructor')).toHaveLength(1)
  })

  it('未声明的 id 返回空数组，不得把原型链上的函数当成依赖数组', async () => {
    const workflow = build([{ id: 'dnspod', name: 'DNSPod', type: 'dnspod' }])

    expect(await workflow.forProvider('toString')).toEqual([])
    expect(await workflow.forProvider('hasOwnProperty')).toEqual([])
    expect(await workflow.forProvider('__proto__')).toEqual([])
  })

  it('偏好行的同步服务商是脏 id 时同样可反查', async () => {
    const workflow = build([], {
      'cf-1:example.com:api.example.com': preferenceRow({
        hostname: 'api.example.com',
        hostname_id: 'h-1',
        sync_provider_id: 'valueOf',
      }),
    })

    expect(await workflow.forProvider('valueOf')).toEqual([
      {
        kind: 'hostname_sync',
        type: 'saas',
        id: 'cf-1:example.com:api.example.com',
        name: 'api.example.com',
        reason: 'SaaS 同步服务商',
      },
    ])
  })

  it('正常关联照常反查（回归对照）', async () => {
    const workflow = build([
      { id: 'edgeone', name: 'EdgeOne', type: 'edgeone', dnspod_provider: 'dnspod' },
      { id: 'dnspod', name: 'DNSPod', type: 'dnspod' },
    ])

    expect(await workflow.forProvider('dnspod')).toEqual([
      { kind: 'provider', type: 'edgeone', id: 'edgeone', name: 'EdgeOne', reason: 'EdgeOne 关联 DNSPod' },
    ])
    expect(await workflow.forProvider('edgeone')).toEqual([])
  })

  it('偏好行同时登记主服务商与同步服务商两条依赖', async () => {
    const workflow = build([], {
      'cf-1:example.com:api.example.com': preferenceRow({
        hostname: 'api.example.com',
        sync_provider_id: 'dnspod',
      }),
    })

    expect(await workflow.forProvider('cf-1')).toEqual([
      {
        kind: 'hostname_owner',
        type: 'saas',
        id: 'cf-1:example.com:api.example.com',
        name: 'api.example.com',
        reason: 'SaaS 主服务商',
      },
    ])
    expect(await workflow.forProvider('dnspod')).toHaveLength(1)
  })
})
