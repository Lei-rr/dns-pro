import { describe, expect, it } from 'vitest'
import type { Provider } from './types'
import { providerConfigItems } from './provider-config-items'

/** 只提供被测分支需要的字段：未列出的走 PresentedProvider 的默认形态 */
function makeProvider(over: Record<string, unknown> = {}): Provider {
  return {
    id: 'provider-1',
    name: 'provider-1',
    type: 'saas',
    configured: false,
    fields: {},
    editable_fields: [],
    ...over,
  } as unknown as Provider
}

describe('providerConfigItems 基础徽章', () => {
  it('dnspod / cloudflare 只显示配置状态徽章', () => {
    expect(providerConfigItems(makeProvider({ type: 'dnspod', configured: true }), [])).toEqual([
      { key: 'api', value: '已配置', ok: true },
    ])
    expect(providerConfigItems(makeProvider({ type: 'cloudflare', configured: false }), [])).toEqual([
      { key: 'api', value: '未配置', ok: false },
    ])
  })

  it('configured 缺失时按未配置处理，ok 为布尔 false 而非 undefined', () => {
    expect(providerConfigItems(makeProvider({ type: 'dnspod' }), [])).toEqual([
      { key: 'api', value: '未配置', ok: false },
    ])
  })

  it('未知类型没有专属配置项，回退到徽章', () => {
    expect(providerConfigItems(makeProvider({ type: 'future', configured: true }), [])).toEqual([
      { key: 'api', value: '已配置', ok: true },
    ])
  })
})

describe('providerConfigItems edgeone 关联', () => {
  const linkedDnspod = makeProvider({ id: 'p-dp', name: 'DNSPod 主账号', type: 'dnspod' })

  it('关联到 DNSPod 时显示链接对象的名字', () => {
    expect(providerConfigItems(makeProvider({ type: 'edgeone', dnspod_provider: 'p-dp' }), [linkedDnspod])).toEqual([
      { key: 'edgeone-dnspod', value: 'DNSPod 主账号', ok: true },
    ])
  })

  it('关联指向不存在的 provider 时显示「未配置」', () => {
    expect(providerConfigItems(makeProvider({ type: 'edgeone', dnspod_provider: 'missing' }), [])).toEqual([
      { key: 'edgeone-dnspod', value: '未配置', ok: true },
    ])
  })

  it('链接对象无名字时回退类型标签；类型也为空时回退「已配置」', () => {
    const unnamed = makeProvider({ id: 'p-dp', name: '', type: 'dnspod' })
    expect(providerConfigItems(makeProvider({ type: 'edgeone', dnspod_provider: 'p-dp' }), [unnamed])).toEqual([
      { key: 'edgeone-dnspod', value: 'DNSPod', ok: true },
    ])

    const anonymous = makeProvider({ id: 'p-x', name: '', type: '' })
    expect(providerConfigItems(makeProvider({ type: 'edgeone', dnspod_provider: 'p-x' }), [anonymous])).toEqual([
      { key: 'edgeone-dnspod', value: '已配置', ok: true },
    ])
  })

  it('顶层字段缺失时从 fields 读取并 trim，顶层字段优先于 fields', () => {
    const linked = makeProvider({ id: 'p-dp', name: '主账号', type: 'dnspod' })
    const other = makeProvider({ id: 'p-2', name: '备用账号', type: 'dnspod' })

    expect(
      providerConfigItems(makeProvider({ type: 'edgeone', fields: { dnspod_provider: ' p-dp ' } }), [linked])
    ).toEqual([{ key: 'edgeone-dnspod', value: '主账号', ok: true }])

    expect(
      providerConfigItems(
        makeProvider({ type: 'edgeone', dnspod_provider: 'p-2', fields: { dnspod_provider: 'p-dp' } }),
        [linked, other]
      )
    ).toEqual([{ key: 'edgeone-dnspod', value: '备用账号', ok: true }])
  })

  it('顶层空白串被 trim 成空后回退 fields，关联不丢失', () => {
    // pick 先 trim 再判空：顶层值为纯空白串时它仍是 truthy，用 || 短路会遮住 fields 里的有效关联
    const linked = makeProvider({ id: 'p-dp', name: '主账号', type: 'dnspod' })
    expect(
      providerConfigItems(
        makeProvider({ type: 'edgeone', dnspod_provider: '   ', fields: { dnspod_provider: 'p-dp' } }),
        [linked]
      )
    ).toEqual([{ key: 'edgeone-dnspod', value: '主账号', ok: true }])
  })

  it('未关联任何 DNSPod 时回退到徽章', () => {
    expect(providerConfigItems(makeProvider({ type: 'edgeone', configured: true }), [])).toEqual([
      { key: 'api', value: '已配置', ok: true },
    ])
  })
})

describe('providerConfigItems saas 关联', () => {
  const cf = makeProvider({ id: 'p-cf', name: 'CF 账号', type: 'cloudflare' })
  const dp = makeProvider({ id: 'p-dp', name: 'DNSPod 账号', type: 'dnspod' })
  const cfDns = makeProvider({ id: 'p-cfdns', name: 'CF DNS 账号', type: 'cloudflare' })

  it('三个关联各自成条：前缀区分用途，顺序固定', () => {
    expect(
      providerConfigItems(
        makeProvider({
          type: 'saas',
          cloudflare_provider: 'p-cf',
          dnspod_provider: 'p-dp',
          cloudflare_dns_provider: 'p-cfdns',
        }),
        [cf, dp, cfDns]
      )
    ).toEqual([
      { key: 'saas-cf', value: 'SaaS：CF 账号', ok: true },
      { key: 'saas-dnspod', value: 'DNSPod 同步：DNSPod 账号', ok: true },
      { key: 'saas-cf-dns', value: 'Cloudflare DNS 同步：CF DNS 账号', ok: true },
    ])
  })

  it('只有部分关联时只显示对应条目', () => {
    expect(providerConfigItems(makeProvider({ type: 'saas', dnspod_provider: 'p-dp' }), [dp])).toEqual([
      { key: 'saas-dnspod', value: 'DNSPod 同步：DNSPod 账号', ok: true },
    ])
    expect(providerConfigItems(makeProvider({ type: 'saas', cloudflare_dns_provider: 'p-cfdns' }), [cfDns])).toEqual([
      { key: 'saas-cf-dns', value: 'Cloudflare DNS 同步：CF DNS 账号', ok: true },
    ])
  })

  it('三个关联都为空时回退到徽章', () => {
    expect(providerConfigItems(makeProvider({ type: 'saas', configured: true }), [])).toEqual([
      { key: 'api', value: '已配置', ok: true },
    ])
  })
})

describe('providerConfigItems cloudflared 关联', () => {
  const cf = makeProvider({ id: 'p-cf', name: 'CF 账号', type: 'cloudflare' })

  it('关联 Cloudflare 时显示链接名', () => {
    expect(providerConfigItems(makeProvider({ type: 'cloudflared', cloudflare_provider: 'p-cf' }), [cf])).toEqual([
      { key: 'tunnel-cf', value: 'CF 账号', ok: true },
    ])
  })

  it('未关联时回退到徽章', () => {
    expect(providerConfigItems(makeProvider({ type: 'cloudflared' }), [cf])).toEqual([
      { key: 'api', value: '未配置', ok: false },
    ])
  })
})

describe('providerConfigItems 凭据不外泄', () => {
  it('密钥字段的值不出现在配置项文本中', () => {
    const items = providerConfigItems(
      makeProvider({
        type: 'saas',
        cloudflare_provider: 'p-cf',
        api_token: 'TOP_SECRET_TOKEN',
        fields: { api_token: 'TOP_SECRET_TOKEN', account_id: 'ACCOUNT_SECRET' },
      }),
      [makeProvider({ id: 'p-cf', name: 'CF 账号', type: 'cloudflare' })]
    )
    expect(JSON.stringify(items)).not.toContain('TOP_SECRET_TOKEN')
    expect(JSON.stringify(items)).not.toContain('ACCOUNT_SECRET')
    expect(items).toEqual([{ key: 'saas-cf', value: 'SaaS：CF 账号', ok: true }])
  })
})
