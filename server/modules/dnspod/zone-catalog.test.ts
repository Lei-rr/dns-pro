import { describe, expect, it } from 'vitest'
import { ApiError } from '../../core/http/api-error.js'
import { toAsciiFqdn } from '../../shared/values.js'
import { DnsPodZoneCatalog } from './zone-catalog.js'

/**
 * 迁移自 scripts/isolated-zone-catalog-probe.ts（P1：纯函数契约；站点列表用本地假实现，无网络）。
 * IDN / punycode / 大小写 / 尾点混用下的最长后缀匹配与 422 错误码。
 */

const zoneService = {
  list: async () => ({
    items: [
      { name: 'example.com', punycode: '' },
      { name: '例子.中国', punycode: 'xn--fsqu00a.xn--fiqs8s' },
      { name: 'sub.example.com', punycode: '' },
    ],
  }),
}
const catalog = new DnsPodZoneCatalog(zoneService as never)

/** 断言拒绝对应的 ApiError：实例类型 + 错误码 + 状态码三项与探针一致 */
async function expectApiError(promise: Promise<unknown>, code: string, statusCode = 422): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason
  )
  expect(error).toBeInstanceOf(ApiError)
  expect(error).toMatchObject({ code, statusCode })
}

describe('FQDN 归一：账号侧与查询侧必须同形', () => {
  it('IDN 转 punycode 小写 ASCII 形态（Unicode 原样保留会永世匹配不上）', () => {
    const idnZone = toAsciiFqdn('例子.中国')
    expect(idnZone).not.toBe('例子.中国')
    expect(idnZone).toMatch(/^[a-z0-9.-]+$/)
    expect(idnZone).toMatch(/^xn--/)
  })
})

describe('DnsPodZoneCatalog：最长后缀匹配与显式站点', () => {
  const idnZone = toAsciiFqdn('例子.中国')

  it('大小写与尾点混用不影响命中；Unicode 查询命中 punycode 站点', async () => {
    // 第三个参数（errorCodePrefix）只影响未命中时的错误码，命中路径与探针调用等价
    expect(await catalog.resolve('dnspod-1', 'WWW.Example.COM.', 'saas')).toBe('example.com')
    expect(await catalog.resolve('dnspod-1', 'WWW.例子.中国.', 'saas')).toBe(idnZone)
    expect(await catalog.resolve('dnspod-1', idnZone, 'saas')).toBe(idnZone)
  })

  it('最长后缀匹配：命中子站点而不是只命中顶级域', async () => {
    expect(await catalog.match('dnspod-1', 'www.sub.example.com')).toBe('sub.example.com')
    expect(await catalog.match('dnspod-1', 'WWW.SUB.Example.Com.')).toBe('sub.example.com')
    expect(await catalog.match('dnspod-1', 'not-example.com')).toBe('')
    expect(await catalog.match('dnspod-1', 'www.other.test')).toBe('')
  })

  it('显式站点接受归一化变体，未登记域名按前缀抛 422', async () => {
    expect(await catalog.requireExplicit('dnspod-1', 'Example.COM.', 'saas')).toBe('example.com')
  })

  it('未登记域名：requireExplicit / resolve 均为 saas_dnspod_zone_not_found', async () => {
    await expectApiError(catalog.requireExplicit('dnspod-1', 'missing.test', 'saas'), 'saas_dnspod_zone_not_found')
    await expectApiError(catalog.resolve('dnspod-1', 'www.missing.test', 'saas'), 'saas_dnspod_zone_not_found')
  })

  it('空白 FQDN：saas_fqdn_empty（先于匹配判定）', async () => {
    await expectApiError(catalog.resolve('dnspod-1', '   ', 'saas'), 'saas_fqdn_empty')
  })
})
