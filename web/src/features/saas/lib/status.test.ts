import { describe, expect, it } from 'vitest'
import { statusVariant } from './status'

/**
 * 徽章色只用灰/黑三档：secondary 常态 / outline 中间态 / default 异常。
 * 语义由 statusLabel 的文案承担，颜色不再表达状态——这条跨模块契约此前没有测试兜着，
 * 一旦谁把 'success'/'warning' 加回来就会在这里断掉。
 */
describe('SaaS 徽章色只用灰/黑三档', () => {
  it('常态、中间态、异常各归其档', () => {
    expect(statusVariant('active')).toBe('secondary')
    expect(statusVariant('moved')).toBe('secondary')
    expect(statusVariant('pending_validation')).toBe('outline')
    expect(statusVariant('initializing')).toBe('outline')
    expect(statusVariant('deleted')).toBe('default')
    expect(statusVariant('blocked')).toBe('default')
  })

  it('空值与未知状态回落 outline，大小写不影响判定', () => {
    expect(statusVariant()).toBe('outline')
    expect(statusVariant(null)).toBe('outline')
    expect(statusVariant('')).toBe('outline')
    expect(statusVariant('something-new')).toBe('outline')
    expect(statusVariant('ACTIVE')).toBe('secondary')
  })

  it('所有已知状态只映射到三档之内', () => {
    const allowed = new Set(['secondary', 'outline', 'default'])
    const statuses = [
      'active',
      'active_renewing',
      'moved',
      'pending',
      'pending_validation',
      'pending_issuance',
      'pending_deployment',
      'initializing',
      'deleted',
      'blocked',
      'pending_deletion',
      'deactivated',
      'unknown',
      '',
    ]
    for (const status of statuses) {
      expect(allowed.has(statusVariant(status))).toBe(true)
    }
  })
})
