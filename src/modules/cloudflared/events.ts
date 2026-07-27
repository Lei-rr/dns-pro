import { eventBus } from '../../platform/events/event-bus.js'
import {
  cloudflaredTunnelConfigCacheTag,
  cloudflaredTunnelsCacheTag,
} from '../../lib/cache/provider-cache.js'

export async function emitTunnelMutated(input: {
  providerId: string
  tunnelId?: string
  action: string
}) {
  await eventBus.emit({
    type: 'tunnel.mutated',
    provider_id: input.providerId,
    target: input.tunnelId,
    action: `cloudflared.tunnel.${input.action}`,
    cache_tags: [cloudflaredTunnelsCacheTag(input.providerId)],
  })
}

export async function emitTunnelRouteMutated(input: {
  providerId: string
  tunnelId: string
  hostname?: string
  action: string
}) {
  await eventBus.emit({
    type: 'tunnel.route.mutated',
    provider_id: input.providerId,
    target: input.tunnelId,
    hostname: input.hostname,
    action: `cloudflared.route.${input.action}`,
    cache_tags: [
      cloudflaredTunnelConfigCacheTag(input.providerId, input.tunnelId),
      cloudflaredTunnelsCacheTag(input.providerId),
    ],
  })
}
