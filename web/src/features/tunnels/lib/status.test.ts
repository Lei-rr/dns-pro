import { describe, expect, it } from 'vitest'
import { tunnelStatusLabel } from './status'

describe('tunnelStatusLabel', () => {
  it('词表内状态各有文案', () => {
    expect(tunnelStatusLabel('healthy')).toBe('已连接')
    expect(tunnelStatusLabel('degraded')).toBe('降级')
    expect(tunnelStatusLabel('down')).toBe('已断开')
    expect(tunnelStatusLabel('inactive')).toBe('未连接')
  })

  it('大小写归一后命中词表', () => {
    expect(tunnelStatusLabel('HEALTHY')).toBe('已连接')
    expect(tunnelStatusLabel('Down')).toBe('已断开')
  })

  it('带首尾空格的状态先 trim 再归一，与 DNS 侧口径一致', () => {
    // 此前只做 toLowerCase 不做 trim，' down ' 会落到「状态未知」，与 dnsZoneStatusLabel 不一致
    expect(tunnelStatusLabel(' down ')).toBe('已断开')
    expect(tunnelStatusLabel('  Healthy  ')).toBe('已连接')
  })

  it('词表外的非空状态显示「状态未知」', () => {
    expect(tunnelStatusLabel('connecting')).toBe('状态未知')
    expect(tunnelStatusLabel('0')).toBe('状态未知')
  })

  it('缺失/空白状态显示占位符「-」', () => {
    expect(tunnelStatusLabel()).toBe('-')
    expect(tunnelStatusLabel('')).toBe('-')
    expect(tunnelStatusLabel('   ')).toBe('-')
  })

  it('词表外的 constructor / __proto__ 沿原型链也取不到值，回落到兜底文案', () => {
    // 裸查表会让 'constructor' / '__proto__' 这类全小写原型键取到 Object 构造器 / Object.prototype（非字符串）；
    // ownValue 只认自有键，因此它们与其它未知状态一样走兜底。
    expect(tunnelStatusLabel('constructor')).toBe('状态未知')
    expect(tunnelStatusLabel('__proto__')).toBe('状态未知')
  })
})
