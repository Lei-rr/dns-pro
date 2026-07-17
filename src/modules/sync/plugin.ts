import type { AppPlugin } from '../../kernel/index.js'
import { ServiceTokens, type SyncPort, type PluginContext } from '../../kernel/index.js'

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
