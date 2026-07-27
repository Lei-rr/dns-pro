import { eventBus } from '../../platform/events/event-bus.js'
import { customHostnameCacheTag } from '../../lib/cache/provider-cache.js'

/**
 * SaaS hostname / zone-scoped custom-hostname cache invalidation.
 * Tags must use Cloudflare provider id + zone id (not SaaS provider id / zone name).
 * Action convention: short verb → prefixed as `saas.hostname.${action}` (same as CF/DNSPod/EdgeOne).
 */
export async function emitSaasHostnameMutated(input: {
  saasProviderId: string
  cloudflareProviderId: string
  zoneName: string
  zoneId: string
  hostname?: string
  action: string
  target?: string
}) {
  await eventBus.emit({
    type: 'saas.hostname.mutated',
    provider_id: input.saasProviderId,
    zone: input.zoneName,
    hostname: input.hostname,
    target: input.target,
    action: `saas.hostname.${input.action}`,
    cache_tags: [customHostnameCacheTag(input.cloudflareProviderId, input.zoneId)],
  })
}

/**
 * Zone-scoped custom-hostname cache bust (fallback origin / forced refresh).
 * Reuses saas.hostname.mutated + cache_tags so subscribers remain the only invalidate path.
 */
export async function emitSaasZoneCacheInvalidated(input: {
  cloudflareProviderId: string
  zoneId: string
  action: string
  saasProviderId?: string
  zoneName?: string
}) {
  await eventBus.emit({
    type: 'saas.hostname.mutated',
    provider_id: input.saasProviderId || input.cloudflareProviderId,
    zone: input.zoneName || input.zoneId,
    action: `saas.hostname.${input.action}`,
    cache_tags: [customHostnameCacheTag(input.cloudflareProviderId, input.zoneId)],
  })
}
