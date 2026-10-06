import { describe, expect, it } from 'vitest'
import {
  ProviderNormalizer,
  PROVIDER_FIELD_MAX_LENGTH_DEFAULT,
  PROVIDER_FIELD_MAX_LENGTHS,
  PROVIDER_ID_PATTERN,
} from './provider-normalizer.js'
import { getProviderDefinition } from './provider-definitions.js'

/**
 * 服务商 ID 只按字符规则放行会漏掉 Object.prototype 上的名字：
 * 下游多处用普通对象做 provider 索引容器（依赖反查 map），id 命中 constructor/toString 时
 * 读到的是原型链上的函数——依赖列表 push 抛错（列表 500）、dependencies.length 恒为 1（删除恒 409）。
 */

const normalizer = new ProviderNormalizer()
const dnspodDefinition = getProviderDefinition('dnspod')
const cloudflareDefinition = getProviderDefinition('cloudflare')
if (!dnspodDefinition || !cloudflareDefinition) throw new Error('缺少服务商定义')

async function captured(run: () => unknown): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  throw new Error('预期抛错但未抛出')
}

describe('服务商 ID：保留键与原型链键', () => {
  it.each([
    'constructor',
    'toString',
    'valueOf',
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable',
    'toLocaleString',
  ])('拒绝原型链键 id=%s', async (id) => {
    expect(await captured(() => normalizer.validateId(id))).toMatchObject({ code: 'validation_failed' })
  })

  it('保留路由名仍大小写不敏感拒绝', async () => {
    expect(await captured(() => normalizer.validateId('HOME'))).toMatchObject({ code: 'validation_failed' })
    expect(await captured(() => normalizer.validateId('providers'))).toMatchObject({ code: 'validation_failed' })
  })

  it('普通合法 id 正常通过并去除首尾空白', () => {
    expect(normalizer.validateId(' my-dns_1 ')).toBe('my-dns_1')
  })
})

describe('密钥字段：拒绝密文前缀输入', () => {
  it('secret_key 带 enc:v1: 前缀被拒（跳过加密会留下无法解密的落盘值）', async () => {
    const error = await captured(() =>
      normalizer.normalize(
        { id: 'dns', type: 'dnspod', secret_id: 'AKID', secret_key: 'enc:v1:truncated' },
        dnspodDefinition
      )
    )
    expect(error).toMatchObject({ code: 'validation_failed' })
  })

  it('api_token 带前缀同样被拒，明文密钥正常归一化', async () => {
    const rejected = await captured(() =>
      normalizer.normalize({ id: 'cf', type: 'cloudflare', api_token: 'enc:v1:a:b:c' }, cloudflareDefinition)
    )
    expect(rejected).toMatchObject({ code: 'validation_failed' })

    const provider = normalizer.normalize(
      { id: 'cf', type: 'cloudflare', api_token: 'plain-token' },
      cloudflareDefinition
    )
    expect(provider.api_token).toBe('plain-token')
  })

  it('非密钥字段不受该规则影响（历史数据里的普通文本照常保存）', () => {
    const provider = normalizer.normalize(
      { id: 'dns', type: 'dnspod', secret_id: 'enc:v1:not-a-secret', secret_key: 'plain-key' },
      dnspodDefinition
    )
    expect(provider.secret_id).toBe('enc:v1:not-a-secret')
  })
})

describe('服务商名称：与其它字段共用同一张长度上限表', () => {
  it('name 超过默认上限（255）被拒：非 HTTP 调用方（脚本/探针/迁移）不经 schema，长度必须在此兜底', async () => {
    const error = await captured(() =>
      normalizer.normalize(
        { id: 'dns', type: 'dnspod', name: 'a'.repeat(256), secret_id: 'AKID', secret_key: 'plain-key' },
        dnspodDefinition
      )
    )
    expect(error).toMatchObject({ code: 'validation_failed' })
  })

  it('name 允许为空（可选字段），纯空白归一为空串', () => {
    const provider = normalizer.normalize(
      { id: 'dns', type: 'dnspod', name: '   ', secret_id: 'AKID', secret_key: 'plain-key' },
      dnspodDefinition
    )
    expect(provider.name).toBe('')
  })
})

/** 服务商 ID 与字段长度上限是 schema 层与归一化层共用的唯一口径，写法漂移必须在这里被拦住 */
describe('服务商 ID 与字段长度上限：两处校验共用的唯一口径', () => {
  it('ID 字符集与长度上限（64）', () => {
    expect(PROVIDER_ID_PATTERN.test('cf-1')).toBe(true)
    expect(PROVIDER_ID_PATTERN.test('CF_1')).toBe(true)
    expect(PROVIDER_ID_PATTERN.test('-cf')).toBe(false)
    expect(PROVIDER_ID_PATTERN.test('cf.1')).toBe(false)
    expect(PROVIDER_ID_PATTERN.test('a'.repeat(64))).toBe(true)
    expect(PROVIDER_ID_PATTERN.test('a'.repeat(65))).toBe(false)
  })

  it('字段长度上限表：密钥与关联字段各有上限，未登记字段回落默认值 255', () => {
    expect(PROVIDER_FIELD_MAX_LENGTH_DEFAULT).toBe(255)
    // 逐字段断言具体上限：只查类型会放过任何数值漂移（schema 层与归一化共用本表）
    const expectedMaxLengths: ReadonlyArray<readonly [string, number]> = [
      ['secret_id', 128],
      ['secret_key', 256],
      ['api_token', 512],
      ['account_id', 128],
      ['dnspod_provider', 64],
      ['cloudflare_provider', 64],
      ['cloudflare_dns_provider', 64],
    ]
    for (const [field, maxLength] of expectedMaxLengths) {
      expect(PROVIDER_FIELD_MAX_LENGTHS[field], `${field} 长度上限漂移`).toBe(maxLength)
    }
  })
})
