import { describe, expect, it } from 'vitest'
import { dnsRecordMatches, relativeRecordName, sameDnsValue, type DnsRecordValue } from './dns-record.port.js'

function record(overrides: Partial<DnsRecordValue> = {}): DnsRecordValue {
  return { type: 'CNAME', name: 'www', value: 'target.edgeone.net', ...overrides }
}

describe('记录值比较：域名类记录忽略大小写与尾点，其余类型精确比较', () => {
  it('CNAME / NS / PTR / MX 归一大小写与全部尾点', () => {
    for (const type of ['CNAME', 'NS', 'PTR', 'MX']) {
      expect(
        sameDnsValue(record({ type, value: 'Target.EdgeOne.NET.' }), record({ type, value: 'target.edgeone.net' }))
      ).toBe(true)
    }
  })

  it('A / TXT 等类型不做大小写归一：值保持精确比较（TXT 内容大小写敏感）', () => {
    expect(sameDnsValue(record({ type: 'A', value: '1.2.3.4' }), record({ type: 'A', value: '1.2.3.4' }))).toBe(true)
    expect(sameDnsValue(record({ type: 'TXT', value: 'Token=Abc' }), record({ type: 'TXT', value: 'token=abc' }))).toBe(
      false
    )
  })

  it('比较只看值本身，两端空白被裁剪', () => {
    expect(sameDnsValue(record({ value: ' target.edgeone.net ' }), record({ value: 'target.edgeone.net' }))).toBe(true)
  })
})

describe('FQDN → 相对主机记录（与 zone 相同为 @）', () => {
  it('zone 自身 → @；子域 → 相对名；大小写与尾点归一', () => {
    expect(relativeRecordName('example.com', 'example.com')).toBe('@')
    expect(relativeRecordName('Example.COM.', 'example.com')).toBe('@')
    expect(relativeRecordName('WWW.Example.com.', 'example.com')).toBe('www')
    expect(relativeRecordName('a.b.example.com', 'example.com')).toBe('a.b')
  })

  it('不属于该 zone 的主机名保持原样（不误裁后缀）', () => {
    expect(relativeRecordName('www.other.com', 'example.com')).toBe('www.other.com')
    expect(relativeRecordName('notexample.com', 'example.com')).toBe('notexample.com')
  })

  it('空 zone 视为根域 → @', () => {
    expect(relativeRecordName('example.com', '')).toBe('@')
  })
})

describe('幂等重放判定：现状是否已经等于期望（厂商字段差异不参与比较）', () => {
  it('期望未声明的可选字段不参与比较：现状多出 TTL / 权重 / 备注也算命中', () => {
    const actual = record({ ttl: 600, weight: 10, note: '上游写入', status: 'ENABLE', line: '默认' })
    expect(dnsRecordMatches(actual, record())).toBe(true)
  })

  it('期望声明的字段必须一致：TTL / 优先级 / 备注 / 状态 / 权重任一不同即未命中', () => {
    const expected = record({ ttl: 60, priority: 5, note: 'edgeone:domain-1', status: 'ENABLE', weight: 1 })
    expect(
      dnsRecordMatches(
        record({ ttl: 60, priority: 5, note: 'edgeone:domain-1', status: 'ENABLE', weight: 1 }),
        expected
      )
    ).toBe(true)
    expect(
      dnsRecordMatches(
        record({ ttl: 600, priority: 5, note: 'edgeone:domain-1', status: 'ENABLE', weight: 1 }),
        expected
      )
    ).toBe(false)
    expect(
      dnsRecordMatches(record({ ttl: 60, priority: 5, note: '别的备注', status: 'ENABLE', weight: 1 }), expected)
    ).toBe(false)
  })

  it('线路以 lineId 优先：期望给出 lineId 时只比 lineId，不再比 line 文案', () => {
    const expected = record({ lineId: '10' })
    expect(dnsRecordMatches(record({ lineId: '10', line: '默认' }), expected)).toBe(true)
    expect(dnsRecordMatches(record({ lineId: '11', line: '默认' }), expected)).toBe(false)
  })

  it('期望未给 lineId 时回退比 line 文案；两者都未给则不比较线路', () => {
    expect(dnsRecordMatches(record({ line: '默认' }), record({ line: '默认' }))).toBe(true)
    expect(dnsRecordMatches(record({ line: '电信' }), record({ line: '默认' }))).toBe(false)
    expect(dnsRecordMatches(record({ line: '电信' }), record())).toBe(true)
  })

  it('名称大小写不敏感、值归一后比较；类型不同直接不命中', () => {
    expect(dnsRecordMatches(record({ name: 'WWW' }), record())).toBe(true)
    expect(dnsRecordMatches(record({ value: 'Target.EdgeOne.NET.' }), record())).toBe(true)
    expect(dnsRecordMatches(record({ type: 'TXT' }), record())).toBe(false)
  })

  it('proxied 显式声明为 false 时，现状未给也视为命中（布尔语义而非存在性）', () => {
    expect(dnsRecordMatches(record(), record({ proxied: false }))).toBe(true)
    expect(dnsRecordMatches(record({ proxied: true }), record({ proxied: false }))).toBe(false)
  })
})
