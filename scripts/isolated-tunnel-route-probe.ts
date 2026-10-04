#!/usr/bin/env node
// 隧道路由：写回顺序、扩展字段与 catch_all 保留、并发写入串行化
// 只桩掉上游 HTTP 与 DNS 副作用，走真实 getConfig/writeIngress 代码路径
import assert from 'node:assert/strict'
import { CloudflareClient } from '../server/src/modules/cloudflare/cloudflare.client.js'
import { TunnelDnsService } from '../server/src/modules/tunnels/tunnel-dns.service.js'
import { TunnelRouteService } from '../server/src/modules/tunnels/tunnel-route.service.js'

type IngressRule = { hostname?: string; service?: string; path?: string; [key: string]: unknown }

const order: string[] = []
// 写回完成后，下一次站点查询失败：模拟「清理旧 CNAME 时查不到站点」
let failNextZoneLookup = false
const zones = {
  async bestMatchId() {
    if (failNextZoneLookup) {
      failNextZoneLookup = false
      order.push('cleanup-old-dns')
      throw new Error('zone lookup 502')
    }
    return 'zone-1'
  },
}
const dnsRecords = {
  async findExact() {
    order.push('ensure-new-dns')
    return []
  },
  async create() {
    return { id: 'new-record' }
  },
}
const dns = new TunnelDnsService(zones as never, dnsRecords as never)

const providers = {
  async requireType(_id: string, type: string) {
    return type === 'cloudflared'
      ? { id: 'tunnel-owner', type: 'cloudflared', cloudflare_provider: 'cf-owner' }
      : { id: 'cf-owner', type: 'cloudflare', api_token: 'token', account_id: 'acct' }
  },
}

let remoteConfig = {
  config: {
    ingress: [
      { hostname: 'old.example.com', service: 'http://origin:80', originRequest: { connectTimeout: 30 } },
      { service: 'http_status:503' },
    ],
  },
  version: 7,
}
let lastPut: { config: { ingress: IngressRule[] } } | null = null
let puts = 0

CloudflareClient.prototype.get = async function (path: string) {
  assert.match(path, /\/configurations$/, `意外 GET ${path}`)
  return { success: true, result: remoteConfig } as never
}
CloudflareClient.prototype.put = async function (path: string, data?: unknown) {
  assert.match(path, /\/configurations$/, `意外 PUT ${path}`)
  order.push('write-ingress')
  puts++
  // 首次写回后让下一次站点查询失败，用于验证清理失败以副作用返回
  if (puts === 1) failNextZoneLookup = true
  lastPut = data as { config: { ingress: IngressRule[] } }
  // 模拟上游往返延迟，暴露并发读-改-写覆盖
  await new Promise((resolve) => setTimeout(resolve, 20))
  remoteConfig = { config: lastPut.config, version: remoteConfig.version + 1 }
  return { success: true, result: remoteConfig } as never
}

const service = new TunnelRouteService(providers as never, zones as never, dns)

// 1. 更新路由：写 ingress → 同步新 CNAME → 清理旧 CNAME
const result = await service.updateRoute('tunnel-owner', 'tunnel-1', 'old.example.com', '', {
  hostname: 'new.example.com',
  service: 'http://origin:80',
  path: '',
})
assert.deepEqual(order, ['write-ingress', 'ensure-new-dns', 'cleanup-old-dns'], `调用顺序异常：${order.join('>')}`)
assert.equal(result.side_effects?.dns?.sync?.status, 'completed')
assert.equal(result.side_effects?.dns?.cleanup?.status, 'failed')

// 2. 真实写回体：扩展字段与自定义 catch_all 必须保留
const ingress = lastPut?.config.ingress ?? []
assert.equal(ingress.length, 2, `ingress 条数异常：${JSON.stringify(ingress)}`)
assert.equal(ingress[0]?.hostname, 'new.example.com')
assert.deepEqual(ingress[0]?.originRequest, { connectTimeout: 30 }, '扩展字段 originRequest 被丢弃')
assert.equal(ingress[1]?.service, 'http_status:503', '自定义 catch_all 被重置')

// 3. 并发新增：串行化后两条路由都必须存在（不能互相覆盖）
const putsBefore = puts
remoteConfig = { config: { ingress: [{ service: 'http_status:503' }] }, version: 1 }
await Promise.all([
  service.addRoute('tunnel-owner', 'tunnel-1', { hostname: 'a.example.com', service: 'http://a:80', path: '' }),
  service.addRoute('tunnel-owner', 'tunnel-1', { hostname: 'b.example.com', service: 'http://b:80', path: '' }),
])
const hosts = (remoteConfig.config.ingress ?? [])
  .filter((rule) => Boolean(rule.hostname))
  .map((rule) => String(rule.hostname))
  .sort()
assert.deepEqual(hosts, ['a.example.com', 'b.example.com'], `并发新增丢失路由：${hosts.join(',')}`)
assert.equal(remoteConfig.config.ingress.at(-1)?.service, 'http_status:503', '并发写入后 catch_all 被重置')
assert.equal(puts - putsBefore, 2, '并发新增应各写一次 ingress')

// 4. 清理失败不应中断响应（cleanup 以副作用形式返回）
assert.equal(result.side_effects?.dns?.cleanup?.status, 'failed')

console.log('tunnel-route-probe=ok order=ingress->dns extensions=kept catch-all=kept concurrent=serialized')
