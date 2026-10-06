import { describe, expect, it } from 'vitest'
import { edgeOneCnameDesired } from './edge-one.planner.js'

/**
 * EdgeOne 加速域名 → 期望 DNS 记录。
 *
 * 期望记录只有一处定义：EdgeOne 同步写入与 repair 共用同一份判据，
 * 字段一旦漂移，两处会各写各的记录，因此这里逐字段钉死字面量。
 */

describe('edgeOneCnameDesired：同步写入与 repair 共用的期望记录', () => {
  it('字段取固定字面量：CNAME + DNSPod 默认线路 + 600s + 备注带主机名', () => {
    expect(edgeOneCnameDesired('www.example.com', 'www.example.com.edgeone.site')).toEqual({
      purpose: 'edgeone_cname',
      fqdn: 'www.example.com',
      owner: 'edgeone',
      refId: 'www.example.com',
      record: {
        type: 'CNAME',
        value: 'www.example.com.edgeone.site',
        line: '默认',
        note: 'EdgeOne 加速丨www.example.com',
        ttl: 600,
      },
    })
  })

  it('fqdn 同时进入 refId 与备注，cname 只进入值', () => {
    const desired = edgeOneCnameDesired('a.b.example.net', 'target.edgeone.site')
    expect(desired.refId).toBe('a.b.example.net')
    expect(desired.record.note).toBe('EdgeOne 加速丨a.b.example.net')
    expect(desired.record.value).toBe('target.edgeone.site')
  })
})
