import { describe, expect, it } from 'vitest'
import type { EdgeOneAccelerationDomain } from './types'
import { edgeOneDomainFormValues, edgeOneDomainSubmitValues } from './domain-command'

/**
 * features/edge-one 表单纯函数：前缀解析（'@' / 子域 / 异 zone）与 host_header 条件提交。
 * 迁移自 scripts/isolated-edge-one-command-probe.ts（探针已退役），断言逐条等价迁入。
 */

describe('EdgeOne 加速域名表单值', () => {
  it('空表单给出可提交的默认值（站点为空时也不能抛错）', () => {
    expect(edgeOneDomainFormValues(undefined, 'example.com')).toEqual({
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
  })

  it('根域：加速域名与站点同名 → @（大小写与尾点先归一）', () => {
    expect(edgeOneDomainFormValues({ name: 'example.com' }, 'example.com').prefix).toBe('@')
    expect(edgeOneDomainFormValues({ name: 'Example.com.' }, 'example.com').prefix).toBe('@')
  })

  it('子域取相对前缀；名称不以站点结尾时原样返回，不得截断成空串', () => {
    expect(edgeOneDomainFormValues({ name: 'www.example.com' }, 'example.com').prefix).toBe('www')
    expect(edgeOneDomainFormValues({ name: 'other.example.net' }, 'example.com').prefix).toBe('other.example.net')
  })

  it('回填既有加速域名：origin 取自嵌套 origin 对象，自定义 HOST 判定为 custom 模式', () => {
    const domain: EdgeOneAccelerationDomain = {
      name: 'www.example.com',
      origin: { type: 'IP_DOMAIN', value: '192.0.2.10', host_header: 'origin.example.net' },
      origin_protocol: 'HTTPS',
      https_origin_port: 8443,
      ipv6_status: 'enable',
    }
    const values = edgeOneDomainFormValues(domain, 'example.com')
    expect(values.prefix).toBe('www')
    expect(values.origin).toBe('192.0.2.10')
    expect(values.origin_protocol).toBe('HTTPS')
    expect(values.https_origin_port).toBe(8443)
    expect(values.host_header).toBe('origin.example.net')
    expect(values.host_header_mode).toBe('custom')
    // 编辑既有域名不得默认勾选自动同步
    expect(values.autoSync).toBe(false)
  })

  it('清空自定义 HOST 后的回读：上游把域名自身作为 HOST 返回，必须仍判定为 accelerate', () => {
    // 真机实测（EdgeOne，下发空串 → 200 → 回读 host_header 等于域名自身）。
    // 按「非空即 custom」判定会让用户清空后重新打开对话框时看到一个自己从未填过的自定义 HOST，
    // 且再提交一次会把「清空」误解成「自定义为域名自身」。
    const domain: EdgeOneAccelerationDomain = {
      name: 'www.example.com',
      origin: { type: 'IP_DOMAIN', value: '192.0.2.10', host_header: 'www.example.com' },
    }
    const values = edgeOneDomainFormValues(domain, 'example.com')
    expect(values.host_header_mode).toBe('accelerate')

    // 大小写与尾点同样归一：上游可能回读 WWW.Example.com.
    const messy: EdgeOneAccelerationDomain = {
      name: 'www.example.com',
      origin: { type: 'IP_DOMAIN', value: '192.0.2.10', host_header: 'WWW.Example.com.' },
    }
    expect(edgeOneDomainFormValues(messy, 'example.com').host_header_mode).toBe('accelerate')
  })

  it('回读域名自身时提交空串，不得把「清空」再写成「自定义为域名自身」', () => {
    const payload = edgeOneDomainSubmitValues({
      origin_type: 'IP_DOMAIN',
      origin: '192.0.2.10',
      origin_protocol: 'HTTP',
      http_origin_port: 80,
      https_origin_port: 443,
      ipv6_status: 'follow',
      host_header: 'www.example.com',
      host_header_mode: 'accelerate',
    })
    expect(payload.host_header).toBe('')
  })
})

describe('EdgeOne 域名提交值（host_header 条件提交）', () => {
  const submitBase = {
    origin_type: 'IP_DOMAIN',
    origin: '192.0.2.10',
    origin_protocol: 'HTTP',
    http_origin_port: 80,
    https_origin_port: 443,
    ipv6_status: 'follow',
  }

  it('自定义 HOST：去掉首尾空白后提交', () => {
    const payload = edgeOneDomainSubmitValues({
      ...submitBase,
      host_header: ' origin.example.net ',
      host_header_mode: 'custom',
    })
    expect(payload.host_header).toBe('origin.example.net')
  })

  it('加速域名模式：必须显式下发空串（清空旧值），省略字段会被后端当成「保持原有配置」', () => {
    const payload = edgeOneDomainSubmitValues({
      ...submitBase,
      host_header: 'origin.example.net',
      host_header_mode: 'accelerate',
    })
    expect(payload.host_header).toBe('')
  })

  it('custom 模式但值为空白：同样按清空处理，不得把空白值提交给上游', () => {
    const payload = edgeOneDomainSubmitValues({ ...submitBase, host_header: '   ', host_header_mode: 'custom' })
    expect(payload.host_header).toBe('')
  })

  it('非 IP_DOMAIN 源站不参与 host_header 语义：字段必须缺席', () => {
    const payload = edgeOneDomainSubmitValues({
      ...submitBase,
      origin_type: 'COS',
      host_header: 'x',
      host_header_mode: 'custom',
    })
    expect('host_header' in payload).toBe(false)
  })
})
