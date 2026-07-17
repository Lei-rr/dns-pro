import { eventBus } from '../../platform/events/event-bus.js'

export async function emitEdgeDomainMutated(input: {
  providerId: string
  zoneId: string
  domainName?: string
  action: string
}) {
  await eventBus.emit({
    type: 'edge.domain.mutated',
    provider_id: input.providerId,
    zone: input.zoneId,
    hostname: input.domainName,
    action: `edgeone.domain.${input.action}`,
    cache_tags: [`edgeone:domains:${input.providerId}:${input.zoneId}`, `edgeone:zones:${input.providerId}`],
  })
}
