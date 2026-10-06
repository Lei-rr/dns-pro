import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DnsRecord } from '@/features/dns/model/types'
import { exportRecordsAsCsv, exportRecordsAsJson, exportRecordsAsZone } from './record-export'

/**
 * 导出下载的可见产物只有三处：Blob 内容、Blob.type（MIME）、anchor.download（文件名）。
 * createObjectURL / revokeObjectURL / click 都走 spy，避免真实导航，
 * 内容在断言时用 Blob.text() 读出，保证测到的是真正写进文件的那串字符。
 */

// 表头按原样拼接（不裹引号）：字段名里没有逗号/引号，仍是合法 CSV 首行
const CSV_HEADER =
  '名称 (Name),类型 (Type),记录值 (Value),TTL,线路 (Line),CDN/代理 (Proxied),备注 (Remark),MX优先级 (Priority)'

let blobs: Blob[] = []
let downloadNames: string[] = []

beforeEach(() => {
  blobs = []
  downloadNames = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    blobs.push(blob as Blob)
    return 'blob:mock-url'
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloadNames.push(this.download)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  // 下载锚点必须被移除：body 里不能留下隐藏的可点击链接
  expect(document.querySelectorAll('a[download]')).toHaveLength(0)
})

async function lastDownload() {
  const blob = blobs[blobs.length - 1] as Blob
  return {
    content: await blob.text(),
    mime: blob.type,
    filename: downloadNames[downloadNames.length - 1] as string,
  }
}

describe('exportRecordsAsJson', () => {
  it('两条记录序列化为 2 空格缩进的 JSON，文件名带 zone 名，MIME 为 application/json', async () => {
    const records: DnsRecord[] = [
      { name: 'www', type: 'A', value: '192.0.2.1', ttl: 300 },
      { name: '@', type: 'MX', value: 'mx1.example.com', priority: 10 },
    ]
    exportRecordsAsJson(records, 'example.com')

    const { content, mime, filename } = await lastDownload()
    expect(content).toBe(JSON.stringify(records, null, 2))
    expect(content).toContain('\n  {\n    "name": "www"')
    expect(mime).toBe('application/json')
    expect(filename).toBe('example.com_dns_records.json')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('空数组导出为 []，仍然触发一次下载', async () => {
    exportRecordsAsJson([], 'example.com')

    const { content, filename } = await lastDownload()
    expect(content).toBe('[]')
    expect(filename).toBe('example.com_dns_records.json')
  })

  it('引号与换行等字符按 JSON 转义写出，不破坏文件结构', async () => {
    exportRecordsAsJson([{ name: 'txt', type: 'TXT', value: 'say "hi"\nbye' }], 'example.com')

    const { content } = await lastDownload()
    expect(content).toBe(JSON.stringify([{ name: 'txt', type: 'TXT', value: 'say "hi"\nbye' }], null, 2))
    expect(JSON.parse(content)).toEqual([{ name: 'txt', type: 'TXT', value: 'say "hi"\nbye' }])
  })
})

describe('exportRecordsAsCsv', () => {
  it('字段齐全：BOM + 表头 + CRLF 行，TTL/线路/代理/备注/优先级逐列写出', async () => {
    exportRecordsAsCsv(
      [
        {
          name: 'www',
          type: 'A',
          value: '192.0.2.1',
          ttl: 300,
          line: '电信',
          proxied: true,
          remark: '主站',
          priority: 5,
        },
      ],
      'example.com'
    )

    const { content, mime, filename } = await lastDownload()
    expect(content).toBe('\uFEFF' + CSV_HEADER + '\r\n"www","A","192.0.2.1","300","电信","true","主站","5"')
    expect(mime).toBe('text/csv;charset=utf-8;')
    expect(filename).toBe('example.com_dns_records.csv')
  })

  it('字段缺省：空记录落到 600 / 默认 / false / 空串，value 可回退 content', async () => {
    exportRecordsAsCsv([{}, { content: 'c.example.com', comment: '备注', mx: 7 }], 'example.com')

    const { content } = await lastDownload()
    const rows = content.replace(/^\uFEFF/, '').split('\r\n')
    expect(rows[1]).toBe('"","","","600","默认","false","",""')
    expect(rows[2]).toBe('"","","c.example.com","600","默认","false","备注","7"')
  })

  it('null 字段统一写空串，不出现字面量 null', async () => {
    // JSON 反序列化不受前端可选类型约束：后端可能真的回 null
    const nullable = JSON.parse(
      JSON.stringify({ name: null, value: null, ttl: null, line: null, remark: null, priority: null })
    ) as DnsRecord
    exportRecordsAsCsv([nullable], 'example.com')

    const { content } = await lastDownload()
    expect(content.split('\r\n')[1]).toBe('"","","","600","默认","false","",""')
    expect(content).not.toContain('null')
    expect(content).not.toContain('undefined')
  })

  it('引号按 RFC4180 双写转义，含引号的字段不会把列切断', async () => {
    exportRecordsAsCsv([{ name: 'a"b', type: 'TXT', value: 'say "hi"', remark: '"quoted"' }], 'example.com')

    const { content } = await lastDownload()
    expect(content.split('\r\n')[1]).toBe('"a""b","TXT","say ""hi""","600","默认","false","""quoted""",""')
  })

  it('value 优先 content、remark 优先 comment、priority 优先 mx', async () => {
    exportRecordsAsCsv(
      [{ name: '@', type: 'MX', value: 'v', content: 'c', remark: 'r', comment: 'c2', priority: 1, mx: 2 }],
      'example.com'
    )

    const { content } = await lastDownload()
    expect(content.split('\r\n')[1]).toBe('"@","MX","v","600","默认","false","r","1"')
  })

  it('空数组只导出表头（末尾不带换行）', async () => {
    exportRecordsAsCsv([], 'example.com')

    const { content, filename } = await lastDownload()
    expect(content).toBe('\uFEFF' + CSV_HEADER)
    expect(filename).toBe('example.com_dns_records.csv')
  })
})

describe('exportRecordsAsZone', () => {
  beforeEach(() => {
    // 只伪造 Date：Blob.text() 之类的微任务不受影响
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-06T12:34:56.789Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('A 记录：名称/TTL/类型按列宽补齐，头部含 ORIGIN 与默认 TTL', async () => {
    exportRecordsAsZone([{ name: 'www', type: 'A', value: '192.0.2.1', ttl: 300 }], 'example.com')

    const { content, mime, filename } = await lastDownload()
    expect(content).toBe(
      [
        '; Zone file for example.com',
        '; Exported at 2026-10-06T12:34:56.789Z',
        '$ORIGIN example.com.',
        '$TTL 600',
        '',
        `${'www'.padEnd(20, ' ')} ${'300'.padEnd(8, ' ')} IN ${'A'.padEnd(8, ' ')} 192.0.2.1`,
      ].join('\n')
    )
    expect(mime).toBe('text/plain')
    expect(filename).toBe('example.com.zone')
  })

  it('MX 分支：priority 优先 mx，二者缺失时回退 10，类型大小写不敏感', async () => {
    exportRecordsAsZone(
      [
        { name: '@', type: 'mx', value: 'mx1.example.com', priority: 20 },
        { name: '@', type: 'MX', value: 'mx2.example.com', mx: 30 },
        { name: '@', type: 'MX', value: 'mx3.example.com' },
      ],
      'example.com'
    )

    const { content } = await lastDownload()
    const lines = content.split('\n')
    expect(lines[5]).toBe(`${'@'.padEnd(20, ' ')} ${'600'.padEnd(8, ' ')} IN ${'MX'.padEnd(8, ' ')} 20 mx1.example.com`)
    expect(lines[6]).toBe(`${'@'.padEnd(20, ' ')} ${'600'.padEnd(8, ' ')} IN ${'MX'.padEnd(8, ' ')} 30 mx2.example.com`)
    expect(lines[7]).toBe(`${'@'.padEnd(20, ' ')} ${'600'.padEnd(8, ' ')} IN ${'MX'.padEnd(8, ' ')} 10 mx3.example.com`)
  })

  it('TXT 分支：值强制加引号，内部引号转义为 \\"', async () => {
    exportRecordsAsZone([{ name: '_dmarc', type: 'TXT', value: 'v=DMARC1; p="none"' }], 'example.com')

    const { content } = await lastDownload()
    expect(content.split('\n')[5]).toBe(
      `${'_dmarc'.padEnd(20, ' ')} ${'600'.padEnd(8, ' ')} IN ${'TXT'.padEnd(8, ' ')} "v=DMARC1; p=\\"none\\""`
    )
  })

  it('缺省字段：name 回退 @、type 回退 A、value 回退 content，超长名称不截断', async () => {
    exportRecordsAsZone(
      [{}, { name: 'a-very-long-hostname-label.example.com', type: 'CNAME', content: 'target.example.com', ttl: '1h' }],
      'example.com'
    )

    const { content } = await lastDownload()
    const lines = content.split('\n')
    expect(lines[5]).toBe(`${'@'.padEnd(20, ' ')} ${'600'.padEnd(8, ' ')} IN ${'A'.padEnd(8, ' ')} `)
    expect(lines[6]).toBe(
      `${'a-very-long-hostname-label.example.com'} ${'1h'.padEnd(8, ' ')} IN ${'CNAME'.padEnd(8, ' ')} target.example.com`
    )
  })

  it('空记录集只写头部 5 行', async () => {
    exportRecordsAsZone([], 'example.com')

    const { content } = await lastDownload()
    expect(content.split('\n')).toHaveLength(5)
    expect(content.endsWith('$TTL 600\n')).toBe(true)
  })
})
