import { eventBus } from '../../platform/events/event-bus.js'
import { providerCacheTag } from '../../lib/cache/provider-cache.js'

/** Provider CRUD — single emit helper (same style as other modules events.ts). */
export async function emitProviderMutated(input: {
  providerId: string
  action: 'create' | 'update' | 'delete'
  target?: string
}) {
  await eventBus.emit({
    type: 'provider.mutated',
    provider_id: input.providerId,
    action: `provider.${input.action}`,
    target: input.target,
    cache_tags: [providerCacheTag(input.providerId)],
  })
}
