import { describe, expect, it } from 'vitest'
import { recordOwnerHint, recordOwnerLabel } from '@/features/dns/lib/record-owner'
import type { DnsRecord } from '@/features/dns/model/types'

/** 模拟后端返回词表之外的归属字符串：JSON 反序列化后的载荷不受前端联合类型约束 */
function recordWithOwner(owner: string): DnsRecord {
  return JSON.parse(JSON.stringify({ owner }))
}

describe('D4 归属标签', () => {
  it('词表内归属照常映射', () => {
    expect(recordOwnerLabel(recordWithOwner('saas'))).toBe('SaaS')
    expect(recordOwnerLabel(recordWithOwner('manual'))).toBe('人工')
  })

  it('原型链上的键名不算归属：不能把原型方法当标签渲染', () => {
    expect(recordOwnerLabel(recordWithOwner('toString'))).toBe('')
    expect(recordOwnerLabel(recordWithOwner('hasOwnProperty'))).toBe('')
    expect(recordOwnerHint(recordWithOwner('toString'))).toBe('')
  })

  it('未返回归属时为空串（不渲染徽标）', () => {
    expect(recordOwnerLabel({})).toBe('')
    expect(recordOwnerHint({})).toBe('')
  })

  it('manual 与非 manual 的说明文案区分派生归属', () => {
    expect(recordOwnerHint(recordWithOwner('manual'))).toBe('无派生归属：自动化流程不会删除该记录')
    expect(recordOwnerHint(recordWithOwner('tunnel'))).toContain('派生关系管理')
  })
})
