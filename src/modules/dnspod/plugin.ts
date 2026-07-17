import type { AppPlugin, PluginContext } from '../../kernel/index.js'
import { ServiceTokens } from '../../kernel/index.js'
import type { DnsPodZoneService } from './services/zone-service.js'
import type { DnsPodRecordService } from './services/record-service.js'
import { DnsPodRecordPortAdapter, DnsPodZonePortAdapter } from './adapters/ports.js'

export function createDnsPodPlugin(zones: DnsPodZoneService, records: DnsPodRecordService): AppPlugin {
  return {
    name: 'dnspod',
    version: '1',
    capabilities: ['zones', 'records'],
    register(ctx: PluginContext) {
      ctx.set(ServiceTokens.DnsPodZonePort, new DnsPodZonePortAdapter(zones))
      ctx.set(ServiceTokens.DnsPodRecordPort, new DnsPodRecordPortAdapter(records))
    },
  }
}
