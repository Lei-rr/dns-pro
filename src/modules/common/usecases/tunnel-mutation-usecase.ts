import type { CloudflaredTunnelService } from '../../cloudflared/services/tunnel-service.js'
import type { CloudflaredRouteService } from '../../cloudflared/services/route-service.js'

/**
 * Thin application usecase for Cloudflare Tunnel mutations.
 */
export class TunnelMutationUseCase {
  constructor(
    private readonly tunnels: CloudflaredTunnelService,
    private readonly routes: CloudflaredRouteService,
  ) {}

  createTunnel(providerId: string, name: string) {
    return this.tunnels.create(providerId, name)
  }

  deleteTunnel(providerId: string, tunnelId: string) {
    return this.tunnels.delete(providerId, tunnelId)
  }

  token(providerId: string, tunnelId: string) {
    return this.tunnels.token(providerId, tunnelId)
  }

  rotateToken(providerId: string, tunnelId: string) {
    return this.tunnels.rotateToken(providerId, tunnelId)
  }

  addRoute(providerId: string, tunnelId: string, route: Record<string, unknown>) {
    return this.routes.addRoute(providerId, tunnelId, route as any)
  }

  updateRoute(
    providerId: string,
    tunnelId: string,
    originalHostname: string,
    originalPath: string,
    route: Record<string, unknown>,
  ) {
    return this.routes.updateRoute(providerId, tunnelId, originalHostname, originalPath, route as any)
  }

  deleteRoute(providerId: string, tunnelId: string, hostname: string, path: string, zoneId: string) {
    return this.routes.deleteRoute(providerId, tunnelId, hostname, path, zoneId)
  }

  buildServiceUrl(protocol: string, address: string) {
    return this.routes.buildServiceUrl(protocol, address)
  }
}
