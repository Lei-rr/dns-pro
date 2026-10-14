import { describe, expect, it } from 'vitest'
import { edgeOneOriginDisplay } from './origin-display'

describe('edgeOneOriginDisplay 源站展示', () => {
  it('HTTP 源站：地址拼接 http_origin_port', () => {
    expect(
      edgeOneOriginDisplay({
        origin: { value: '150.40.181.85' },
        origin_protocol: 'HTTP',
        http_origin_port: 80,
        https_origin_port: 443,
      })
    ).toBe('150.40.181.85:80')
  })

  it('HTTPS 源站：地址拼接 https_origin_port', () => {
    expect(
      edgeOneOriginDisplay({
        origin: { value: 'origin.example.com' },
        origin_protocol: 'https',
        http_origin_port: 80,
        https_origin_port: 8443,
      })
    ).toBe('origin.example.com:8443')
  })

  it('FOLLOW 与缺省协议按 HTTP 端口展示', () => {
    expect(
      edgeOneOriginDisplay({
        origin: { value: '1.2.3.4' },
        origin_protocol: 'FOLLOW',
        http_origin_port: 8080,
        https_origin_port: 443,
      })
    ).toBe('1.2.3.4:8080')
    expect(edgeOneOriginDisplay({ origin: { value: '1.2.3.4' } })).toBe('1.2.3.4:80')
  })

  it('上游未回传端口时退到协议默认端口', () => {
    expect(edgeOneOriginDisplay({ origin: { value: '1.2.3.4' }, origin_protocol: 'HTTP' })).toBe('1.2.3.4:80')
    expect(edgeOneOriginDisplay({ origin: { value: '1.2.3.4' }, origin_protocol: 'HTTPS' })).toBe('1.2.3.4:443')
  })

  it('IPv6 源站：加方括号后再拼端口', () => {
    expect(
      edgeOneOriginDisplay({ origin: { value: '240e:1:2::5' }, origin_protocol: 'HTTP', http_origin_port: 80 })
    ).toBe('[240e:1:2::5]:80')
  })

  it('地址已含端口：原样展示，不重复拼接', () => {
    expect(edgeOneOriginDisplay({ origin: { value: '1.2.3.4:8080' }, http_origin_port: 80 })).toBe('1.2.3.4:8080')
    expect(edgeOneOriginDisplay({ origin: { value: '[240e::1]:8443' }, http_origin_port: 80 })).toBe('[240e::1]:8443')
  })

  it('无源站地址：退回源站类型或占位符', () => {
    // 列表响应里源站类型落在 origin.type（presentDomain 不产出顶层 origin_type），顶层字段仅作兜底
    expect(edgeOneOriginDisplay({ origin: { type: 'IP_DOMAIN' } })).toBe('IP_DOMAIN')
    expect(edgeOneOriginDisplay({ origin_type: 'IP_DOMAIN' })).toBe('IP_DOMAIN')
    expect(edgeOneOriginDisplay({})).toBe('-')
  })
})
