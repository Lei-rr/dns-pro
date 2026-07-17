import type { AppPlugin, PluginContext } from '../../kernel/index.js'
import type { CloudflaredTunnelService } from './services/tunnel-service.js'
import type { CloudflaredRouteService } from './services/route-service.js'
import { eventBus } from '../../platform/events/event-bus.js'

export const CloudflaredServiceTokens = {
  Tunnels: 'svc.cloudflared.tunnels',
  Routes: 'svc.cloudflared.routes',
} as const

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

export function createCloudflaredPlugin(input: {
  tunnels: CloudflaredTunnelService
  routes: CloudflaredRouteService
}): AppPlugin {
  return {
    name: 'cloudflared',
    version: '1',
    capabilities: ['tunnel'],
    register(ctx: PluginContext) {
      ctx.set(CloudflaredServiceTokens.Tunnels, input.tunnels)
      ctx.set(CloudflaredServiceTokens.Routes, input.routes)
    },
  }
}
