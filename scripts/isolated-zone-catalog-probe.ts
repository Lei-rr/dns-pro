#!/usr/bin/env node
// DnsPodZoneCatalog：IDN / punycode / 大小写 / 尾点混用下的最长后缀匹配
import assert from 'node:assert/strict'
import { ApiError } from '../server/core/http/api-error.js'
import { DnsPodZoneCatalog } from '../server/modules/dnspod/zone-catalog.js'
import { toAsciiFqdn } from '../server/shared/values.js'

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

// 账号侧与查询侧必须归一成同一形态：IDN 站点以 punycode 落库，Unicode 查询也要能命中
const idnZone = toAsciiFqdn('例子.中国')
assert.notEqual(idnZone, '例子.中国', 'IDN 必须转成 ASCII 形态')
assert.match(idnZone, /^[a-z0-9.-]+$/, '归一结果必须是小写 ASCII')
assert.match(idnZone, /^xn--/, '归一结果必须是 punycode')

// 大小写与尾点混用
assert.equal(await catalog.resolve('dnspod-1', 'WWW.Example.COM.'), 'example.com')
assert.equal(await catalog.resolve('dnspod-1', 'WWW.例子.中国.'), idnZone, 'Unicode 查询必须命中 punycode 站点')
assert.equal(await catalog.resolve('dnspod-1', idnZone), idnZone)

// 最长后缀匹配：不能只命中顶级域
assert.equal(await catalog.match('dnspod-1', 'www.sub.example.com'), 'sub.example.com')
assert.equal(await catalog.match('dnspod-1', 'WWW.SUB.Example.Com.'), 'sub.example.com')
assert.equal(await catalog.match('dnspod-1', 'not-example.com'), '')
assert.equal(await catalog.match('dnspod-1', 'www.other.test'), '')

// 显式站点：同样接受归一化变体，未登记域名按前缀抛 422
assert.equal(await catalog.requireExplicit('dnspod-1', 'Example.COM.'), 'example.com')
await assert.rejects(
  catalog.requireExplicit('dnspod-1', 'missing.test', 'saas'),
  (error: unknown) =>
    error instanceof ApiError && error.code === 'saas_dnspod_zone_not_found' && error.statusCode === 422
)
await assert.rejects(
  catalog.resolve('dnspod-1', 'www.missing.test', 'saas'),
  (error: unknown) =>
    error instanceof ApiError && error.code === 'saas_dnspod_zone_not_found' && error.statusCode === 422
)
await assert.rejects(
  catalog.resolve('dnspod-1', '   ', 'saas'),
  (error: unknown) => error instanceof ApiError && error.code === 'saas_fqdn_empty' && error.statusCode === 422
)

console.log('zone-catalog-probe=ok idn=punycode case=insensitive trailing-dot=stripped suffix=longest error=422')
