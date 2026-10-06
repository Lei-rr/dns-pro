import { describe, expect, it } from 'vitest'
import type { DnsRecord } from '../model/types'
import { parseDnsFile } from './record-import'
import { buildImportPreview } from './record-import-preview'

/**
 * features/dns 导入纯函数：文件解析（CSV / JSON / BIND）与导入 diff。
 * 迁移自 scripts/isolated-dns-import-probe.ts（探针已退役），断言逐条等价迁入。
 */

/** 后端载荷不受前端类型约束：用 JSON 反序列化构造测试记录（同 record-owner.test.ts 的做法） */
function dnsRecord(payload: Record<string, unknown>): DnsRecord {
  return JSON.parse(JSON.stringify(payload)) as DnsRecord
}

describe('DNS 导入文件解析', () => {
  it('无表头 CSV：首行是数据，`mail` / `mx` 这类短词命中不得把整行当表头吞掉', () => {
    const headerless = parseDnsFile('mail,MX,10 mx.example.com\n@,A,192.0.2.1', 'records.csv')
    expect(headerless).toHaveLength(2)
    expect(headerless[0]).toEqual({ name: 'mail', type: 'MX', value: '10 mx.example.com' })
    expect(headerless[1]).toEqual({ name: '@', type: 'A', value: '192.0.2.1' })
  })

  it('真表头（含中文）被识别并跳过，且按列名取值而不是按位置', () => {
    const withHeader = parseDnsFile('主机记录,类型,记录值,TTL,线路\nwww,A,192.0.2.2,1h,默认', 'records.csv')
    expect(withHeader).toHaveLength(1)
    expect(withHeader[0]).toEqual({ name: 'www', type: 'A', value: '192.0.2.2', ttl: 3600, line: '默认' })
  })

  it('JSON 数组分支按对象数组解析', () => {
    expect(parseDnsFile('[{"name":"www","type":"A","value":"192.0.2.3"}]', 'records.json')).toEqual([
      { name: 'www', type: 'A', value: '192.0.2.3' },
    ])
  })

  it('BIND 区域文件逐行解析，$TTL 作为缺省 TTL 落到记录上', () => {
    const bind = parseDnsFile(
      '$TTL 600\n$ORIGIN example.com.\n@ IN A 192.0.2.4\nwww IN CNAME target.example.net.',
      'zone.txt'
    )
    expect(bind).toHaveLength(2)
    expect(bind[1]).toEqual({ name: 'www', type: 'CNAME', value: 'target.example.net.', ttl: 600 })
  })
})

describe('导入 diff（buildImportPreview）', () => {
  it('同一条 existing 只能被覆盖一次：其余同名同类型值必须按新增处理，不得静默丢数据', () => {
    const preview = buildImportPreview(
      [
        { name: 'www', type: 'A', value: '192.0.2.10' },
        { name: 'www', type: 'A', value: '192.0.2.11' },
        { name: 'WWW', type: 'a', value: '192.0.2.9' },
      ],
      [dnsRecord({ id: 'r1', name: 'www', type: 'A', value: '192.0.2.9' })]
    )
    expect(preview.overwritten).toHaveLength(1)
    expect(preview.overwritten[0]?.existing.id).toBe('r1')
    expect(preview.added.map((record) => record.value)).toEqual(['192.0.2.11'])
    expect(preview.duplicates).toHaveLength(1)
  })
})
