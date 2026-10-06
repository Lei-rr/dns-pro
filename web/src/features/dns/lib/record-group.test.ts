import { describe, expect, it } from 'vitest'
import { recordHostKey, shouldCollapseHostGroup } from './record-group'

/**
 * 邮箱套件（MX / SPF / DKIM / DMARC）必须折叠为同一主机组。
 * 迁移自 scripts/isolated-dns-import-probe.ts（探针已退役）：记录散落在 @ / mail._domainkey / _dmarc
 * 这些不同前缀下，但用户视角是同一个「邮箱」——聚组键与折叠判定都要把它们视为一个组。
 */

const mailRecords = [
  { name: '@', type: 'MX', value: 'mx1.example.com' },
  { name: '@', type: 'TXT', value: 'v=spf1 include:spf.example.com ~all' },
  { name: 'mail._domainkey', type: 'TXT', value: 'v=DKIM1; k=rsa; p=probe' },
  { name: '_dmarc', type: 'TXT', value: 'v=DMARC1; p=none' },
]

describe('邮箱套件聚组与折叠', () => {
  it('MX / SPF / DKIM / DMARC 折叠为同一主机组，且普通主机不与之同组', () => {
    const mailKeys = new Set(mailRecords.map((record) => recordHostKey(record, 'example.com')))
    // 集合内容随断言打印，便于定位是哪条记录没归进同一组
    expect([...mailKeys]).toHaveLength(1)
    expect(recordHostKey({ name: 'www', type: 'A', value: '192.0.2.1' }, 'example.com')).not.toBe(
      mailKeys.values().next().value
    )
  })

  it('邮箱套件必须折叠（组头收起为一行）', () => {
    expect(shouldCollapseHostGroup(mailRecords, 'example.com')).toBe(true)
  })
})
