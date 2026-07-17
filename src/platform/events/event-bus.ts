export type DomainEventType =
  | 'record.mutated'
  | 'zone.mutated'
  | 'saas.hostname.mutated'
  | 'saas.preferred_apply.finished'
  | 'provider.mutated'
  | 'job.updated'

export type DomainEvent = {
  type: DomainEventType
  ts: number
  provider_id?: string
  zone?: string
  hostname?: string
  target?: string
  action?: string
  result?: 'success' | 'failed' | 'skipped'
  message?: string
  meta?: Record<string, unknown>
  cache_tags?: string[]
}

type Handler = (event: DomainEvent) => void | Promise<void>

/**
 * In-process domain event bus.
 * Keep handlers best-effort: one failure must not break publishers.
 */
export class EventBus {
  private readonly handlers = new Map<DomainEventType | '*', Set<Handler>>()

  on(type: DomainEventType | '*', handler: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(handler)
    return () => this.handlers.get(type)?.delete(handler)
  }

  async emit(event: Omit<DomainEvent, 'ts'> & { ts?: number }): Promise<void> {
    const full: DomainEvent = { ...event, ts: event.ts ?? Date.now() }
    const list = [
      ...(this.handlers.get(full.type) ?? []),
      ...(this.handlers.get('*') ?? []),
    ]
    for (const handler of list) {
      try {
        await handler(full)
      } catch {
        // swallow subscriber errors
      }
    }
  }
}

export const eventBus = new EventBus()
