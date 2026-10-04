/**
 * 隧道路由 → 期望 DNS 记录（§4.2 planner）。
 *
 * Ingress 路由是来源，Cloudflare CNAME（<tunnel>.cfargotunnel.com，强制代理）是派生投影。
 * 与之相同的判据也用于隧道 repair：期望记录只有一处定义。
 */
import { normalizeFqdn } from '../../../lib/values.js'
import type { ProviderRepository } from '../../../kernel/providers/provider.repository.js'
import type { ZoneCatalog } from '../../../domains/cloudflare/zone-catalog.js'
import type { TunnelService } from '../../../domains/cloudflare/tunnel/tunnel.service.js'
import type { TunnelRouteService } from '../../../domains/cloudflare/tunnel/tunnel-route.service.js'
import type { DerivedSourcePlanner, PlannedRecord } from '../derived-record.types.js'
import type { DesiredRecord } from '../sync-plan.js'

/** 隧道 CNAME 目标：Cloudflare 隧道的固定回源域名 */
const tunnelCnameTarget = (tunnelId: string) => `${tunnelId}.cfargotunnel.com`

/** 隧道 CNAME 期望记录（走 Cloudflare 代理，TTL 自动） */
function tunnelCnameDesired(fqdn: string, tunnelId: string): DesiredRecord {
  return {
    purpose: 'tunnel_cname',
    fqdn,
    owner: 'tunnel',
    refId: tunnelId,
    record: { type: 'CNAME', value: tunnelCnameTarget(tunnelId), proxied: true, ttl: 1 },
  }
}

/** 隧道路由扫描：cloudflared 服务商 → 隧道 → Ingress 主机名 → Cloudflare CNAME（只读） */
export function tunnelDerivedPlanner(deps: {
  providers: ProviderRepository
  tunnels: TunnelService
  routes: TunnelRouteService
  catalog: ZoneCatalog
}): DerivedSourcePlanner {
  return {
    kind: 'tunnel-route',
    async scan(scope): Promise<PlannedRecord[]> {
      const records: PlannedRecord[] = []
      // 同一主机名被多条隧道路由声明时保留首个（与 D4 归属取证顺序一致），避免自相冲突的计划
      const claimedHosts = new Set<string>()
      const providers = (await deps.providers.all()).filter((provider) => provider.type === 'cloudflared')
      for (const link of providers) {
        const cloudflareProviderId = String(link.cloudflare_provider ?? '')
        if (cloudflareProviderId === '') continue
        if (scope.providerId && scope.providerId !== link.id && scope.providerId !== cloudflareProviderId) continue
        for (const tunnel of (await deps.tunnels.list(link.id)).items) {
          if (!tunnel.id) continue
          const config = await deps.routes.getConfig(link.id, tunnel.id)
          const hostnames = [...new Set(config.routes.map((route) => normalizeFqdn(route.hostname)))]
          for (const fqdn of hostnames) {
            if (fqdn === '') continue
            const hostKey = `${cloudflareProviderId}|${fqdn}`
            if (claimedHosts.has(hostKey)) continue
            const zone = await deps.catalog.resolve(cloudflareProviderId, fqdn)
            if (!zone) continue
            claimedHosts.add(hostKey)
            const desired = tunnelCnameDesired(fqdn, tunnel.id)
            records.push({
              source: { kind: 'tunnel-route', providerId: link.id, id: tunnel.id },
              target: { providerType: 'cloudflare', providerId: cloudflareProviderId, zone: zone.zoneName, fqdn },
              owner: 'tunnel',
              purpose: desired.purpose,
              desired,
            })
          }
        }
      }
      return records
    },
  }
}
