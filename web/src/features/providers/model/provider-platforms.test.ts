import { describe, expect, it } from 'vitest'
import { isDnsPlatform } from './provider-platforms'

describe('isDnsPlatform', () => {
  it('DNSPod 与 Cloudflare 是 DNS 托管平台', () => {
    expect(isDnsPlatform('dnspod')).toBe(true)
    expect(isDnsPlatform('cloudflare')).toBe(true)
  })

  it('其余服务商类型不是 DNS 托管平台', () => {
    expect(isDnsPlatform('edgeone')).toBe(false)
    expect(isDnsPlatform('saas')).toBe(false)
    expect(isDnsPlatform('cloudflared')).toBe(false)
  })

  it('空值、未知类型与大小写变体都返回 false', () => {
    expect(isDnsPlatform('')).toBe(false)
    expect(isDnsPlatform('DNSPod')).toBe(false)
    expect(isDnsPlatform('unknown')).toBe(false)
  })
})
