import { describe, expect, it } from 'vitest'
import {
  buildAccelerationDomainRequest,
  normalizeAccelerationDomainPayload,
  normalizeAccelerationDomainUpdatePayload,
} from './edge-one-domain-payload.js'

/**
 * 迁移自 scripts/isolated-edge-one-payload-probe.ts（P1：纯函数契约）。
 * 导入与生产代码相同的模块路径，逐条搬移断言，不复制实现逻辑。
 */

const normalized = normalizeAccelerationDomainPayload({
  domain_name: ' WWW.Example.COM ',
  origin: ' 192.0.2.1 ',
  host_header: ' ORIGIN.Example.COM ',
})

describe('加速域名载荷归一化（创建路径）', () => {
  it('域名小写去空白、源站去空白、回源 HOST 小写，其余字段回填默认值', () => {
    expect(normalized).toEqual({
      domain_name: 'www.example.com',
      origin: '192.0.2.1',
      origin_type: 'IP_DOMAIN',
      host_header: 'origin.example.com',
      origin_protocol: 'FOLLOW',
      http_origin_port: 80,
      https_origin_port: 443,
      ipv6_status: 'follow',
    })
  })

  it('创建请求把归一结果映射为上游字段（含 OriginInfo 嵌套结构）', () => {
    expect(buildAccelerationDomainRequest('zone-1', normalized)).toEqual({
      ZoneId: 'zone-1',
      DomainName: 'www.example.com',
      OriginInfo: { OriginType: 'IP_DOMAIN', Origin: '192.0.2.1', HostHeader: 'origin.example.com' },
      OriginProtocol: 'FOLLOW',
      IPv6Status: 'follow',
      HttpOriginPort: 80,
      HttpsOriginPort: 443,
    })
  })

  it('HTTPS 回源协议不下发 HTTP 端口，仅下发 HTTPS 端口', () => {
    const httpsOnly = buildAccelerationDomainRequest('zone-1', { ...normalized, origin_protocol: 'HTTPS' })
    expect(httpsOnly.HttpOriginPort).toBeUndefined()
    expect(httpsOnly.HttpsOriginPort).toBe(443)
  })

  it('缺少 domain_name → validation_failed', () => {
    expect(() => normalizeAccelerationDomainPayload({})).toThrowError(
      expect.objectContaining({ code: 'validation_failed' })
    )
  })
})

describe('加速域名载荷（更新路径：只归一显式提供的字段）', () => {
  it('显式空串 HostHeader 必须原样下发（用户清空自定义 HOST 不能被丢弃）', () => {
    expect(
      buildAccelerationDomainRequest(
        'zone-1',
        { domain_name: 'www.example.com', origin_type: 'IP_DOMAIN', origin: '192.0.2.1', host_header: '' },
        'update'
      ).OriginInfo
    ).toEqual({ OriginType: 'IP_DOMAIN', Origin: '192.0.2.1', HostHeader: '' })
  })

  it('未提供 HostHeader 时不下发（避免每次改源站都重置回源 HOST）', () => {
    expect(
      buildAccelerationDomainRequest('zone-1', { domain_name: 'www.example.com', origin: '192.0.2.1' }, 'update')
        .OriginInfo
    ).toEqual({ Origin: '192.0.2.1' })
  })

  it('创建路径的空串 HostHeader 仍省略（没有旧值可清空，避免上游对空串报错）', () => {
    expect(buildAccelerationDomainRequest('zone-1', { ...normalized, host_header: '' }).OriginInfo).toEqual({
      OriginType: 'IP_DOMAIN',
      Origin: '192.0.2.1',
    })
  })

  it('更新归一化保留空串表达（纯空白也归一为空串而非 undefined）', () => {
    expect(
      normalizeAccelerationDomainUpdatePayload({ domain_name: 'WWW.Example.com.', host_header: '   ' }).host_header
    ).toBe('')
  })
})
