import { eventBus, type DomainEvent } from './event-bus.js'
import { invalidateProviderCache } from '../../lib/cache/provider-cache.js'

const CACHE_EVENTS = new Set([
  'record.mutated',
  'zone.mutated',
  'saas.hostname.mutated',
  'edge.domain.mutated',
  'tunnel.mutated',
  'tunnel.route.mutated',
  'provider.mutated',
])

let registered = false

/**
 * Wire platform side-effects to domain events (cache invalidate).
 * Idempotent: safe to call multiple times in the same process.
 */
export function registerEventSubscribers(): void {
  if (registered) return
  registered = true

  eventBus.on('*', async (event: DomainEvent) => {
    if (CACHE_EVENTS.has(event.type) && event.cache_tags?.length) {
      invalidateProviderCache(event.cache_tags)
    }
  })
}
