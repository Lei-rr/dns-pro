import { describe, expect, it } from 'vitest'
import type { ProviderPageProps } from './provider-page-props'
import { toDnsProviderRef } from './to-dns-provider'

function props(over: Partial<ProviderPageProps> = {}): ProviderPageProps {
  return { providerId: 'provider-1', providerName: '主账号', providerType: 'dnspod', zoneId: 'example.com', ...over }
}

describe('toDnsProviderRef', () => {
  it('只取 id/type/name 三键，zoneId 不进入 DNS provider 引用', () => {
    const ref = toDnsProviderRef(props())
    expect(ref).toEqual({ id: 'provider-1', type: 'dnspod', name: '主账号' })
    expect(Object.keys(ref).sort()).toEqual(['id', 'name', 'type'])
  })

  it('saas 与 cloudflare 类型原样透传', () => {
    expect(toDnsProviderRef(props({ providerType: 'saas' }))).toEqual({
      id: 'provider-1',
      type: 'saas',
      name: '主账号',
    })
    expect(toDnsProviderRef(props({ providerType: 'cloudflare', providerName: 'CF 账号' }))).toEqual({
      id: 'provider-1',
      type: 'cloudflare',
      name: 'CF 账号',
    })
  })

  it('provider 未加载时类型为空串，如实透传而不是伪造类型', () => {
    expect(toDnsProviderRef(props({ providerType: '' }))).toEqual({ id: 'provider-1', type: '', name: '主账号' })
  })
})
