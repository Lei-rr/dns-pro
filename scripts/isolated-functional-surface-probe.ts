#!/usr/bin/env node
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

const providerEntry = read('web/src/pages/provider-entry/ProviderEntryPage.vue')
for (const component of [
  'ZonesPanel',
  'RecordsPanel',
  'SaasHostsPanel',
  'EdgeOneZonesPanel',
  'AccelerationDomainsPanel',
  'TunnelsPanel',
  'TunnelDetailPanel',
]) {
  assert.match(providerEntry, new RegExp(`\\b${component}\\b`), `provider entry lost ${component}`)
}
for (const type of ['dnspod', 'cloudflare', 'saas', 'edgeone', 'cloudflared']) {
  assert.match(providerEntry, new RegExp(`['"]${type}['"]`), `provider entry lost ${type}`)
}

const capabilities: Record<string, string[]> = {
  // 说明：服务商排序接口仅保留后端（路由目录为 append-only），前端暂无排序入口
  'web/src/features/providers/api/provider-api.ts': [
    'configured',
    'list',
    'definitions',
    'create',
    'update',
    'remove',
    'test',
  ],
  'web/src/features/dns/api/dns-api.ts': [
    'zones',
    'createZone',
    'deleteZone',
    'records',
    'createRecord',
    'updateRecord',
    'deleteRecord',
    'batchCreateRecords',
    'batchDeleteRecords',
    'batchUpdateRecords',
    'batchJob',
    'batchRetry',
    'batchActive',
  ],
  'web/src/features/saas/api/saas-api.ts': [
    'hostnames',
    'hostname',
    'createHostname',
    'updateHostname',
    'deleteHostname',
    'reconcileHostname',
    'repairHostnameDns',
    'fallbackOrigin',
    'setFallbackOrigin',
    'deleteFallbackOrigin',
    'preferredApplyPreview',
    'preferredApply',
    'preferredApplyActive',
    'preferredApplyJob',
    'preferredApplyRetry',
    'batchDelete',
    'batchUpdate',
    'batchActive',
    'batchJob',
    'batchRetry',
  ],
  'web/src/features/edge-one/api/edge-one-api.ts': [
    'zones',
    'zone',
    'accelerationDomains',
    'createAccelerationDomain',
    'updateAccelerationDomain',
    'updateAccelerationDomainStatus',
    'updateCertificate',
    'deleteAccelerationDomain',
    'repairAccelerationDomainDns',
    'batchDisable',
    'batchDelete',
    'batchActive',
    'batchJob',
    'batchRetry',
  ],
  'web/src/features/tunnels/api/tunnel-api.ts': [
    'tunnels',
    'tunnel',
    'createTunnel',
    'deleteTunnel',
    'tunnelToken',
    'rotateToken',
    'routes',
    'addRoute',
    'updateRoute',
    'deleteRoute',
  ],
}
for (const [file, methods] of Object.entries(capabilities)) {
  const source = read(file)
  for (const method of methods) {
    assert.match(source, new RegExp(`\\b${method}\\s*:`), `${file} lost ${method}`)
  }
}

const routes = JSON.parse(read('scripts/api-route-manifest.json')) as Array<{ method: string; path: string }>
const routeSurface = `${routes
  .map((route) => `${route.method} ${route.path}`)
  .sort()
  .join('\n')}\n`
assert.equal(routes.length, 90, 'backend API route count changed')
assert.equal(
  crypto.createHash('sha256').update(routeSurface).digest('hex'),
  'aa135590b8fb336eb0754a176e552f816f47574c8c5a8e4e3a60ef256c899426',
  'backend API method/path surface changed'
)
console.log('functional-surface-probe=ok providers=5 api_methods=66 routes=90')
