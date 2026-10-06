import { describe, expect, it } from 'vitest'
import { edgeOneHttpsStatusLabel, edgeOneHttpsVariant, edgeOneStatusVariant } from './status'

/**
 * 迁移自 scripts/isolated-edge-one-https-status-probe.ts。
 *
 * 原探针的源码结构断言（表头必须含 HTTPS、空表 colspan="7"）已删除：文案与列数属于实现细节，
 * 表格加一列即误报，而把 certificate 换成别的字段却因为字符串仍在别处出现而漏报。
 */

describe('EdgeOne HTTPS 状态文案（certificate → 展示）', () => {
  it('缺少证书或 mode=disable → 未开启', () => {
    expect(edgeOneHttpsStatusLabel()).toBe('未开启')
    expect(edgeOneHttpsStatusLabel({ mode: 'disable' })).toBe('未开启')
  })

  it('免费证书申请中 / 付费证书已部署 → 复用证书状态文案', () => {
    expect(edgeOneHttpsStatusLabel({ mode: 'eofreecert', items: [{ status: 'applying' }] })).toBe('申请中')
    expect(edgeOneHttpsStatusLabel({ mode: 'sslcert', list: [{ status: 'deployed' }] })).toBe('已部署')
  })

  it('已开启但无证书状态 → 已开启', () => {
    expect(edgeOneHttpsStatusLabel({ mode: 'eofreecert', items: [] })).toBe('已开启')
  })
})

/**
 * 与 saas/lib/status.ts 用同一套灰/黑三档：secondary 常态 / outline 中间态 / default 异常。
 * 颜色不再承载语义，文案由 edgeOneStatusLabel / certificateStatusLabel 负责。
 */
describe('EdgeOne 徽章色只用灰/黑三档', () => {
  it('常态、中间态、异常各归其档', () => {
    expect(edgeOneStatusVariant('online')).toBe('secondary')
    expect(edgeOneStatusVariant('deployed')).toBe('secondary')
    expect(edgeOneStatusVariant('applying')).toBe('outline')
    expect(edgeOneStatusVariant('processing')).toBe('outline')
    expect(edgeOneStatusVariant('failed')).toBe('default')
    expect(edgeOneStatusVariant('forbidden')).toBe('default')
  })

  it('未知状态回落 outline，大小写与空白不影响判定', () => {
    expect(edgeOneStatusVariant()).toBe('outline')
    expect(edgeOneStatusVariant('whatever')).toBe('outline')
    expect(edgeOneStatusVariant('  ONLINE  ')).toBe('secondary')
  })

  it('所有已知状态只映射到三档之内', () => {
    const allowed = new Set(['secondary', 'outline', 'default'])
    const statuses = [
      'online',
      'active',
      'deployed',
      'process',
      'pending',
      'init',
      'applying',
      'processing',
      'offline',
      'forbidden',
      'failed',
      'unknown',
      '',
    ]
    for (const status of statuses) {
      expect(allowed.has(edgeOneStatusVariant(status))).toBe(true)
    }
  })

  it('HTTPS 徽章与状态徽章同源', () => {
    expect(edgeOneHttpsVariant()).toBe('outline')
    expect(edgeOneHttpsVariant({ mode: 'disable' })).toBe('outline')
    expect(edgeOneHttpsVariant({ mode: 'eofreecert', items: [{ status: 'deployed' }] })).toBe('secondary')
    expect(edgeOneHttpsVariant({ mode: 'sslcert', list: [{ status: 'failed' }] })).toBe('default')
    // 已开启但无证书状态：与 edgeOneHttpsStatusLabel 的「已开启」一致，用常态灰
    expect(edgeOneHttpsVariant({ mode: 'eofreecert', items: [] })).toBe('secondary')
  })
})
