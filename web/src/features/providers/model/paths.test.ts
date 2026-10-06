import { describe, expect, it } from 'vitest'
import { providerPath, providerTypeLabel } from './paths'

describe('providerPath', () => {
  it('生成 /p/ 前缀的服务商详情路径', () => {
    expect(providerPath('provider-1')).toBe('/p/provider-1')
  })

  it('路径段做 URL 编码：斜杠与空格不会逃出前缀', () => {
    expect(providerPath('a/b c')).toBe('/p/a%2Fb%20c')
    expect(providerPath('供应商')).toBe('/p/%E4%BE%9B%E5%BA%94%E5%95%86')
  })

  it('空 id 也保持前缀结构', () => {
    expect(providerPath('')).toBe('/p/')
  })
})

describe('providerTypeLabel', () => {
  it('已知类型返回品牌名', () => {
    expect(providerTypeLabel('dnspod')).toBe('DNSPod')
    expect(providerTypeLabel('cloudflare')).toBe('Cloudflare')
    expect(providerTypeLabel('saas')).toBe('Cloudflare SaaS')
    expect(providerTypeLabel('edgeone')).toBe('EdgeOne')
    expect(providerTypeLabel('cloudflared')).toBe('Cloudflare Tunnel')
  })

  it('未知类型原样返回（后端新增类型时不至于显示空）', () => {
    expect(providerTypeLabel('future-type')).toBe('future-type')
    expect(providerTypeLabel('')).toBe('')
  })
})
