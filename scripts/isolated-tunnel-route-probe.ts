#!/usr/bin/env node
// 隧道路由：写回顺序、扩展字段与 catch_all 保留、并发写入串行化、CNAME 归属保护与 repair 幂等
// 只桩掉上游 HTTP 与 DNS 副作用，走真实 getConfig/writeIngress/repairRoutes 代码路径
import assert from 'node:assert/strict'
import { CloudflareClient } from '../server/src/domains/cloudflare/cloudflare.client.js'
import { TunnelDnsService } from '../server/src/domains/cloudflare/tunnel/tunnel-dns.service.js'
import { TunnelRouteService } from '../server/src/domains/cloudflare/tunnel/tunnel-route.service.js'

type IngressRule = { hostname?: string; service?: string; path?: string; [key: string]: unknown }
type DnsRecord = { id: string; content: string | null }

const order: string[] = []
// 写回完成后，下一次站点查询失败：模拟「清理旧 CNAME 时查不到站点」
let failNextZoneLookup = false
// repair 场景：让下一次站点查询抛错（验证单条失败不中断其它主机名）
let failNextZoneLookupOnce = false
const zones = {
  async bestMatchId() {
    if (failNextZoneLookupOnce) {
      failNextZoneLookupOnce = false
      throw new Error('zone lookup 502')
    }
    if (failNextZoneLookup) {
      failNextZoneLookup = false
      order.push('cleanup-old-dns')
      throw new Error('zone lookup 502')
    }
    return 'zone-1'
  },
}
// findExact 返回值可切换：数组=固定结果，函数=按主机名返回（覆盖归属冲突与幂等重放）
let findExactResult: DnsRecord[] | ((name: string) => DnsRecord[]) = []
let creates = 0
let updates = 0
const dnsRecords = {
  async findExact(_providerId: string, _zoneId: string, name: string) {
    order.push('ensure-new-dns')
    return typeof findExactResult === 'function' ? findExactResult(name) : findExactResult
  },
  async create() {
    creates++
    return { id: `record-${creates}` }
  },
  async update() {
    updates++
    return { id: 'updated-record' }
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

// 5. repair：首次为全部路由建立 CNAME；重复调用幂等（已正确记录不产生变更）
remoteConfig = {
  config: {
    ingress: [
      { hostname: 'repair-a.example.com', service: 'http://a:80' },
      { hostname: 'repair-b.example.com', service: 'http://b:80' },
      { service: 'http_status:404' },
    ],
  },
  version: 9,
}
findExactResult = []
const createsBeforeRepair = creates
const firstRepair = await service.repairRoutes('tunnel-owner', 'tunnel-1')
assert.deepEqual(
  firstRepair.hostnames.map((item) => item.action),
  ['created', 'created']
)
assert.equal(creates - createsBeforeRepair, 2, 'repair 首次应为两条路由各建一条 CNAME')
assert.equal(firstRepair.side_effects?.dns?.sync?.status, 'completed')

findExactResult = [{ id: 'record-existing', content: 'tunnel-1.cfargotunnel.com' }]
const replay = await service.repairRoutes('tunnel-owner', 'tunnel-1')
assert.deepEqual(
  replay.hostnames.map((item) => item.action),
  ['unchanged', 'unchanged']
)
assert.equal(creates - createsBeforeRepair, 2, 'repair 重放不得重复创建记录')
assert.equal(updates, 0, 'repair 重放不得更新记录')
assert.equal(replay.side_effects?.dns?.sync?.status, 'completed')

// 6. 归属保护：同名 CNAME 指向其它目标时不覆盖、不新建，侧效应记为跳过
findExactResult = [{ id: 'user-record', content: 'other-tunnel.cfargotunnel.com' }]
const conflict = await service.repairRoutes('tunnel-owner', 'tunnel-1')
assert.deepEqual(
  conflict.hostnames.map((item) => item.action),
  ['skipped', 'skipped']
)
assert.equal(conflict.hostnames[0]?.reason, 'record_conflict')
assert.match(String(conflict.hostnames[0]?.message), /other-tunnel\.cfargotunnel\.com/)
assert.equal(creates - createsBeforeRepair, 2, '冲突时不得新建记录')
assert.equal(updates, 0, '冲突时不得覆盖记录')
assert.equal(conflict.side_effects?.dns?.sync?.status, 'skipped')
assert.match(String(conflict.side_effects?.dns?.sync?.message), /跳过 2 条/)

// 7. 混合结果：正确记录保持不动、冲突记录跳过，汇总如实反映
remoteConfig = {
  config: {
    ingress: [
      { hostname: 'ok.example.com', service: 'http://ok:80' },
      { hostname: 'busy.example.com', service: 'http://busy:80' },
      { service: 'http_status:404' },
    ],
  },
  version: 10,
}
findExactResult = (name) =>
  name === 'ok.example.com'
    ? [{ id: 'ok-record', content: 'tunnel-1.cfargotunnel.com' }]
    : [{ id: 'busy-record', content: 'other-tunnel.cfargotunnel.com' }]
const mixed = await service.repairRoutes('tunnel-owner', 'tunnel-1')
assert.deepEqual(
  mixed.hostnames.map((item) => item.action),
  ['unchanged', 'skipped']
)
assert.equal(mixed.side_effects?.dns?.sync?.status, 'completed')
assert.match(String(mixed.side_effects?.dns?.sync?.message), /跳过 1 条/)

// 8. 单条站点解析异常只记失败，不中断其它主机名
findExactResult = []
failNextZoneLookupOnce = true
const degraded = await service.repairRoutes('tunnel-owner', 'tunnel-1')
assert.deepEqual(
  degraded.hostnames.map((item) => item.action),
  ['failed', 'created']
)
assert.equal(degraded.hostnames[0]?.error, 'zone lookup 502')
assert.equal(degraded.side_effects?.dns?.sync?.status, 'failed')

console.log(
  'tunnel-route-probe=ok order=ingress->dns extensions=kept catch-all=kept concurrent=serialized ownership=guarded repair=idempotent'
)
