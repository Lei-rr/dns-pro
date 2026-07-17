import { eventBus } from '../../platform/events/event-bus.js'

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
    cache_tags: [`cloudflared:tunnels:${input.providerId}`],
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
      `cloudflared:tunnel_config:${input.providerId}:${input.tunnelId}`,
      `cloudflared:tunnels:${input.providerId}`,
    ],
  })
}
