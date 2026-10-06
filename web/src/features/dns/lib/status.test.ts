import { describe, expect, it } from 'vitest'
import { dnsZoneStatusLabel } from './status'

describe('dnsZoneStatusLabel', () => {
  it('生效类状态统一显示「已生效」', () => {
    expect(dnsZoneStatusLabel('enable')).toBe('已生效')
    expect(dnsZoneStatusLabel('enabled')).toBe('已生效')
    expect(dnsZoneStatusLabel('active')).toBe('已生效')
    expect(dnsZoneStatusLabel('online')).toBe('已生效')
  })

  it('停用/配置中/处理中/封禁/删除各有文案', () => {
    expect(dnsZoneStatusLabel('disable')).toBe('已停用')
    expect(dnsZoneStatusLabel('disabled')).toBe('已停用')
    expect(dnsZoneStatusLabel('offline')).toBe('已停用')
    expect(dnsZoneStatusLabel('pending')).toBe('配置中')
    expect(dnsZoneStatusLabel('processing')).toBe('处理中')
    expect(dnsZoneStatusLabel('forbidden')).toBe('已封禁')
    expect(dnsZoneStatusLabel('deleted')).toBe('已删除')
  })

  it('大小写与首尾空格归一后命中词表', () => {
    expect(dnsZoneStatusLabel(' ENABLE ')).toBe('已生效')
    expect(dnsZoneStatusLabel('Pending')).toBe('配置中')
  })

  it('词表外的非空状态显示「状态未知」', () => {
    expect(dnsZoneStatusLabel('suspended')).toBe('状态未知')
    expect(dnsZoneStatusLabel('0')).toBe('状态未知')
  })

  it('缺失/空白状态显示占位符「-」', () => {
    expect(dnsZoneStatusLabel()).toBe('-')
    expect(dnsZoneStatusLabel(null)).toBe('-')
    expect(dnsZoneStatusLabel('')).toBe('-')
    expect(dnsZoneStatusLabel('   ')).toBe('-')
  })

  it('词表外的 constructor / __proto__ 沿原型链也取不到值，回落到兜底文案', () => {
    // 映射表是对象字面量且直接下标取值时，'constructor' / '__proto__' 全小写且沿原型链存在，
    // 返回的不是字符串而是函数 / 原型对象；ownValue 只认自有键，因此与其它未知状态同样走兜底。
    expect(dnsZoneStatusLabel('constructor')).toBe('状态未知')
    expect(dnsZoneStatusLabel('__proto__')).toBe('状态未知')
  })
})
