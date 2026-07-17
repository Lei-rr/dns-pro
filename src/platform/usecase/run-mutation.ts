import { ApiError } from '../../lib/http/api-error.js'
import { eventBus } from '../events/event-bus.js'
import type { DomainEventType } from '../events/event-bus.js'
import { featureFlags } from '../features/feature-flags.js'

export type MutationMeta = {
  type: DomainEventType
  action: string
  provider_id?: string
  zone?: string
  hostname?: string
  target?: string
  message?: string
  cache_tags?: string[]
  meta?: Record<string, unknown>
}

/**
 * Run a mutation and emit a domain event afterwards.
 * Audit/cache side-effects are handled by event subscribers.
 */
export async function runMutation<T>(
  meta: MutationMeta,
  work: () => Promise<T>,
): Promise<T> {
  try {
    const result = await work()
    await eventBus.emit({
      type: meta.type,
      action: meta.action,
      provider_id: meta.provider_id,
      zone: meta.zone,
      hostname: meta.hostname,
      target: meta.target,
      message: meta.message,
      cache_tags: meta.cache_tags,
      result: 'success',
      meta: featureFlags.isEnabled('audit_verbose')
        ? { ...(meta.meta || {}), verbose: true }
        : meta.meta,
    })
    return result
  } catch (error) {
    await eventBus.emit({
      type: meta.type,
      action: meta.action,
      provider_id: meta.provider_id,
      zone: meta.zone,
      hostname: meta.hostname,
      target: meta.target,
      result: 'failed',
      message: error instanceof Error ? error.message : String(error),
      meta: meta.meta,
    })
    if (error instanceof ApiError) throw error
    throw error
  }
}
