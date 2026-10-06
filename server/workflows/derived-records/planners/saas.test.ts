import { describe, expect, it } from 'vitest'
import { cloudflareDnsCleanupRecipe } from './saas.planner.js'

/**
 * 主机名已删除后的清理配方：主机名不存在，记录只能按「名称 + 类型 + 备注」匹配，
 * 因此取值必须为空、备注必须与写入路径同源（syncRemark），且必须自带来源 refId——
 * 否则要么匹配不到自己写过的记录，要么把人工记录当成自己的（归属不明一律不能删）。
 */

describe('cloudflareDnsCleanupRecipe：按名称定位且备注可证明归属', () => {
  it('覆盖业务 CNAME / DCV 委派 / 所有权 TXT，取值留空并按备注匹配', () => {
    const recipe = cloudflareDnsCleanupRecipe('www.example.com', 'cf-dns', 'example.com')
    expect(recipe).toHaveLength(3)

    const byPurpose = new Map(recipe.map((record) => [record.purpose, record]))
    const origin = byPurpose.get('origin_cname')
    expect(origin?.fqdn).toBe('www.example.com')
    expect(origin?.record.type).toBe('CNAME')
    expect(origin?.record.value).toBe('')
    expect(origin?.record.note).toBe('业务接入丨www.example.com')

    const dcv = byPurpose.get('dcv_delegation')
    expect(dcv?.fqdn).toBe('_acme-challenge.www.example.com')
    expect(dcv?.record.type).toBe('CNAME')
    expect(dcv?.record.value).toBe('')

    const ownership = byPurpose.get('ownership_verification')
    expect(ownership?.fqdn).toBe('_cf-custom-hostname.www.example.com')
    expect(ownership?.record.type).toBe('TXT')
    expect(ownership?.record.value).toBe('')

    for (const record of recipe) {
      expect(record.provider_type).toBe('cloudflare')
      expect(record.provider_id).toBe('cf-dns')
      expect(record.zone).toBe('example.com')
      // 关系已消失：必须携带来源，否则清理会被 D4 归属门禁拒绝
      expect(record.refId).toBe('www.example.com')
      expect(record.owner).toBe('saas')
    }
  })
})
