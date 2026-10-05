#!/usr/bin/env node
// features/edge-one 表单纯函数：前缀解析（'@' / 子域 / 异 zone）与 host_header 条件提交
import assert from 'node:assert/strict'
import {
  edgeOneDomainFormValues,
  edgeOneDomainSubmitValues,
} from '../web/src/features/edge-one/model/domain-command.js'

// 空表单必须给出可提交的默认值（站点为空时也不能抛错）
const blank = edgeOneDomainFormValues(undefined, 'example.com')
assert.deepEqual(blank, {
  prefix: '',
  origin_type: 'IP_DOMAIN',
  origin: '',
  origin_protocol: 'HTTP',
  http_origin_port: 80,
  https_origin_port: 443,
  host_header: '',
  host_header_mode: 'accelerate',
  ipv6_status: 'follow',
  autoSync: false,
})

// 根域：加速域名与站点同名 → '@'
assert.equal(edgeOneDomainFormValues({ name: 'example.com' } as never, 'example.com').prefix, '@')
// 大小写与尾点先归一：站点写成 EXAMPLE.COM. 时同样按根域处理
assert.equal(edgeOneDomainFormValues({ name: 'Example.com.' } as never, 'example.com').prefix, '@')
assert.equal(edgeOneDomainFormValues({ name: 'www.example.com' } as never, 'example.com').prefix, 'www')
// 名称不以站点结尾：原样返回，不得截断成空串
assert.equal(edgeOneDomainFormValues({ name: 'other.example.net' } as never, 'example.com').prefix, 'other.example.net')
// 回填既有加速域名：origin 取自嵌套 origin 对象，自定义 HOST 判定为 custom 模式
const existing = edgeOneDomainFormValues(
  {
    name: 'www.example.com',
    origin: { type: 'IP_DOMAIN', value: '192.0.2.10', host_header: 'origin.example.net' },
    origin_protocol: 'HTTPS',
    https_origin_port: 8443,
    ipv6_status: 'enable',
  } as never,
  'example.com'
)
assert.equal(existing.prefix, 'www')
assert.equal(existing.origin, '192.0.2.10')
assert.equal(existing.origin_protocol, 'HTTPS')
assert.equal(existing.https_origin_port, 8443)
assert.equal(existing.host_header, 'origin.example.net')
assert.equal(existing.host_header_mode, 'custom')
assert.equal(existing.autoSync, false, '编辑既有域名不得默认勾选自动同步')

const submitBase = {
  origin_type: 'IP_DOMAIN',
  origin: '192.0.2.10',
  origin_protocol: 'HTTP',
  http_origin_port: 80,
  https_origin_port: 443,
  ipv6_status: 'follow',
}

// 自定义 HOST：去掉首尾空白后提交
assert.equal(
  edgeOneDomainSubmitValues({ ...submitBase, host_header: ' origin.example.net ', host_header_mode: 'custom' })
    .host_header,
  'origin.example.net'
)
// 加速域名模式：必须显式下发空串（清空旧值），省略字段会被后端当成「保持原有配置」
assert.equal(
  submitBase &&
    edgeOneDomainSubmitValues({ ...submitBase, host_header: 'origin.example.net', host_header_mode: 'accelerate' })
      .host_header,
  ''
)
// custom 模式但值为空白：同样按清空处理，不得把空白值提交给上游
assert.equal(
  edgeOneDomainSubmitValues({ ...submitBase, host_header: '   ', host_header_mode: 'custom' }).host_header,
  ''
)
// 非 IP_DOMAIN 源站不参与 host_header 语义：字段必须缺席
assert.equal(
  'host_header' in
    edgeOneDomainSubmitValues({ ...submitBase, origin_type: 'COS', host_header: 'x', host_header_mode: 'custom' }),
  false
)

console.log('edge-one-command-probe=ok prefix=root/sub/foreign host-header=trim/clear/absent')
