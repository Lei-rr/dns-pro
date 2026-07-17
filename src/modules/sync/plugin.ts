import type { AppPlugin } from '../../contracts/index.js'
import { ServiceTokens, type SyncPort, type PluginContext } from '../../contracts/index.js'

/**
 * Sync domain plugin — registers the unified SyncPort implementation.
 */
export function createSyncPlugin(sync: SyncPort): AppPlugin {
  return {
    name: 'sync',
    version: '1',
    capabilities: ['dns_sync'],
    register(ctx: PluginContext) {
      ctx.set(ServiceTokens.SyncPort, sync)
    },
  }
}
