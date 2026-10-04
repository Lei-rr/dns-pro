#!/usr/bin/env node
// features/dns 导入纯函数：文件解析（CSV/JSON/BIND）+ 导入 diff + 邮箱套件聚组
import assert from 'node:assert/strict'
import { parseDnsFile } from '../web/src/features/dns/lib/record-import.js'
import { buildImportPreview } from '../web/src/features/dns/lib/record-import-preview.js'
import { recordHostKey, shouldCollapseHostGroup } from '../web/src/features/dns/lib/record-remark.js'

// 无表头 CSV 的首行是数据：单个 `mx` 之类的短词命中不得把整行当表头吞掉
const headerless = parseDnsFile('mail,MX,10 mx.example.com\n@,A,192.0.2.1', 'records.csv')
assert.equal(headerless.length, 2, '无表头 CSV 不得吞掉首行')
assert.deepEqual(headerless[0], { name: 'mail', type: 'MX', value: '10 mx.example.com' })
assert.deepEqual(headerless[1], { name: '@', type: 'A', value: '192.0.2.1' })

// 真表头（含中文）必须被识别并跳过，且按列名取值而不是按位置
const withHeader = parseDnsFile('主机记录,类型,记录值,TTL,线路\nwww,A,192.0.2.2,1h,默认', 'records.csv')
assert.equal(withHeader.length, 1, '有表头 CSV 不得把表头当数据')
assert.deepEqual(withHeader[0], { name: 'www', type: 'A', value: '192.0.2.2', ttl: 3600, line: '默认' })

// JSON 与 BIND 分支
assert.deepEqual(parseDnsFile('[{"name":"www","type":"A","value":"192.0.2.3"}]', 'records.json'), [
  { name: 'www', type: 'A', value: '192.0.2.3' },
])
const bind = parseDnsFile(
  '$TTL 600\n$ORIGIN example.com.\n@ IN A 192.0.2.4\nwww IN CNAME target.example.net.',
  'zone.txt'
)
assert.equal(bind.length, 2, 'BIND 区域文件必须逐行解析')
assert.deepEqual(bind[1], { name: 'www', type: 'CNAME', value: 'target.example.net.', ttl: 600 })

// 导入 diff：同一条 existing 只能被覆盖一次，其余同名同类型值必须按新增处理，不得静默丢数据
const existing = [{ id: 'r1', name: 'www', type: 'A', value: '192.0.2.9' }]
const preview = buildImportPreview(
  [
    { name: 'www', type: 'A', value: '192.0.2.10' },
    { name: 'www', type: 'A', value: '192.0.2.11' },
    { name: 'WWW', type: 'a', value: '192.0.2.9' },
  ],
  existing as never
)
assert.equal(preview.overwritten.length, 1, '同一条 existing 只能被覆盖一次')
assert.deepEqual(preview.overwritten[0]?.existing.id, 'r1')
assert.deepEqual(
  preview.added.map((record) => record.value),
  ['192.0.2.11'],
  '第二条同主机同类型值必须按新增处理'
)
assert.equal(preview.duplicates.length, 1, '同名同类型同值必须判为重复')

// 邮箱套件（MX/SPF/DKIM/DMARC）必须折叠为同一主机组
const mailRecords = [
  { name: '@', type: 'MX', value: 'mx1.example.com' },
  { name: '@', type: 'TXT', value: 'v=spf1 include:spf.example.com ~all' },
  { name: 'mail._domainkey', type: 'TXT', value: 'v=DKIM1; k=rsa; p=probe' },
  { name: '_dmarc', type: 'TXT', value: 'v=DMARC1; p=none' },
]
const mailKeys = new Set(mailRecords.map((record) => recordHostKey(record, 'example.com')))
assert.equal(mailKeys.size, 1, `邮箱套件必须折叠为同一主机组，实际 ${[...mailKeys].join(' | ')}`)
assert.equal(shouldCollapseHostGroup(mailRecords, 'example.com'), true, '邮箱套件必须折叠')
assert.equal(
  recordHostKey({ name: 'www', type: 'A', value: '192.0.2.1' }, 'example.com') === mailKeys.values().next().value,
  false
)

console.log(
  'dns-import-probe=ok csv=headerless-first-row json=array bind=zone txt=single-hit-mail mailbox=fold diff=single-overwrite'
)
