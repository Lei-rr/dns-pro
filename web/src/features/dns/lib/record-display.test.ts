import { describe, expect, it } from 'vitest'
import type { DnsRecord } from '../model/types'
import { buildDnsRecordDisplayRows } from './record-display'

/**
 * 展示行装配：折叠组整体前置。
 *
 * 折叠行是「这台主机有多少条」的摘要，散在独立记录之间会把列表切成碎片，
 * 也让「当前有几组折叠、各自多少条」无法一眼扫完。
 * 组内与组间顺序仍由 compareRecordsForGroup 决定：这里只钉住「组在前、单条在后」，
 * 以及前置不等于合并——组内记录不得被吞并或重新分配。
 */

const ZONE = 'example.com'

function record(id: string, name: string, type: string, value: string): DnsRecord {
  return { id, name, type, value, line: '默认' }
}

/** 同主机 2 条 CNAME：命中 shouldCollapseHostGroup 的「同主机多线路 CNAME」分支 */
function cnamePair(host: string): DnsRecord[] {
  return [
    record(`${host}-1`, host, 'CNAME', `${host}-a.example.net`),
    record(`${host}-2`, host, 'CNAME', `${host}-b.example.net`),
  ]
}

describe('buildDnsRecordDisplayRows：折叠组整体前置', () => {
  it('两个折叠组排在两条独立记录之前，组内条数不因前置改变', () => {
    // 输入刻意打散：独立记录夹在两组之间，输出必须是「组、组、单条、单条」
    const rows = buildDnsRecordDisplayRows(
      [
        record('blog-1', 'blog', 'A', '192.0.2.1'),
        ...cnamePair('www'),
        record('mail-1', 'mail', 'MX', '10 mx.example.net'),
        ...cnamePair('shop'),
      ],
      ZONE
    )

    expect(rows.map((row) => row.kind)).toEqual(['group', 'group', 'single', 'single'])
    expect(rows.filter((row) => row.kind === 'group').map((row) => row.records.length)).toEqual([2, 2])
  })

  it('只有独立记录或只有折叠组时都不产生空段', () => {
    const singles = buildDnsRecordDisplayRows(
      [record('a-1', 'a', 'A', '192.0.2.1'), record('b-1', 'b', 'A', '192.0.2.2')],
      ZONE
    )
    expect(singles.map((row) => row.kind)).toEqual(['single', 'single'])

    const groups = buildDnsRecordDisplayRows(cnamePair('a'), ZONE)
    expect(groups.map((row) => row.kind)).toEqual(['group'])
  })
})
