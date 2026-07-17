import { eventBus, type DomainEvent } from './event-bus.js'
import { auditService } from '../../lib/utils/audit.js'
import { invalidateProviderCache } from '../../lib/cache/provider-cache.js'

/**
 * Wire platform side-effects to domain events.
 * Call once during app context bootstrap.
 */
export function registerEventSubscribers(): void {
  eventBus.on('*', async (event: DomainEvent) => {
    await auditService.write({
      ts: event.ts,
      action: event.action || event.type,
      provider_id: event.provider_id,
      zone: event.zone,
      hostname: event.hostname,
      target: event.target,
      result: event.result ?? 'success',
      message: event.message,
      meta: { type: event.type, ...(event.meta || {}) },
    })
  })

  eventBus.on('record.mutated', async (event) => {
    if (event.cache_tags?.length) invalidateProviderCache(event.cache_tags)
  })

  eventBus.on('zone.mutated', async (event) => {
    if (event.cache_tags?.length) invalidateProviderCache(event.cache_tags)
  })

  eventBus.on('saas.hostname.mutated', async (event) => {
    if (event.cache_tags?.length) invalidateProviderCache(event.cache_tags)
  })
}
