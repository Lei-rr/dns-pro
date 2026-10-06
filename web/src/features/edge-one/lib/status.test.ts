import { describe, expect, it } from 'vitest'
import { edgeOneHttpsStatusLabel } from './status'

/**
 * 迁移自 scripts/isolated-edge-one-https-status-probe.ts。
 *
 * 原探针的源码结构断言（表头必须含 HTTPS、空表 colspan="7"）已删除：文案与列数属于实现细节，
 * 表格加一列即误报，而把 certificate 换成别的字段却因为字符串仍在别处出现而漏报。
 */

describe('EdgeOne HTTPS 状态文案（certificate → 展示）', () => {
  it('缺少证书或 mode=disable → 未开启', () => {
    expect(typeof edgeOneHttpsStatusLabel).toBe('function')
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
