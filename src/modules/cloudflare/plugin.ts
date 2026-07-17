import type { AppPlugin, PluginContext } from '../../contracts/index.js'
import { ServiceTokens } from '../../contracts/index.js'
import type { CloudflareZoneService } from './services/zone-service.js'
import type { CloudflareDnsRecordService } from './services/dns-record-service.js'
import { CloudflareRecordPortAdapter, CloudflareZonePortAdapter } from './adapters/ports.js'

export function createCloudflarePlugin(
  zones: CloudflareZoneService,
  records: CloudflareDnsRecordService,
): AppPlugin {
  return {
    name: 'cloudflare',
    version: '1',
    capabilities: ['zones', 'records'],
    register(ctx: PluginContext) {
      ctx.set(ServiceTokens.CloudflareZonePort, new CloudflareZonePortAdapter(zones))
      ctx.set(ServiceTokens.CloudflareRecordPort, new CloudflareRecordPortAdapter(records))
    },
  }
}
