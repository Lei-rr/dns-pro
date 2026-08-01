#!/usr/bin/env node
import assert from 'node:assert/strict'
import { CloudflaredDnsService } from '../src/modules/tunnels/tunnel-dns.service.js'
import { CloudflaredRouteService } from '../src/modules/tunnels/tunnel-route.service.js'

const order: string[] = []
let zoneLookups = 0
const zones = {
  async bestMatchId() {
    zoneLookups++
    if (zoneLookups === 1) return 'zone-new'
    order.push('cleanup-old-dns')
    throw new Error('zone lookup 502')
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
const dns = new CloudflaredDnsService(zones as never, dnsRecords as never)
const service = new CloudflaredRouteService({} as never, zones as never, dns) as unknown as {
  updateRoute(...args: unknown[]): Promise<Record<string, any>>
  cfProviderIdOf(): Promise<string>
  fetchRoutes(): Promise<Array<{ hostname: string; service: string; path: string }>>
  writeIngress(): Promise<void>
}
service.cfProviderIdOf = async () => 'cf-owner'
service.fetchRoutes = async () => [{ hostname: 'old.example.com', service: 'http://origin:80', path: '' }]
service.writeIngress = async () => {
  order.push('write-ingress')
}

const result = await service.updateRoute('tunnel-owner', 'tunnel-1', 'old.example.com', '', {
  hostname: 'new.example.com',
  service: 'http://origin:80',
  path: '',
})
assert.deepEqual(order, ['write-ingress', 'ensure-new-dns', 'cleanup-old-dns'])
assert.equal(result.side_effects?.dns?.sync?.status, 'completed')
assert.equal(result.side_effects?.dns?.cleanup?.status, 'failed')
console.log('tunnel-route-probe=ok')
