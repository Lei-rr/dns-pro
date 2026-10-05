/**
 * D4：hostname 级所有权查询（基于派生关系）。
 *
 * 归属不落盘：每次按 DNS 目标向三条派生关系取证——
 *   1. 隧道路由（Ingress hostname → Cloudflare CNAME）
 *   2. SaaS 主机名（生效同步目标落在该 DNS 目标上的自定义主机名）
 *   3. EdgeOne 加速域名（关联 DNSPod 账号下的加速域名）
 * 同一主机名多来源声明时保留首个（来源注册顺序即优先级）；未命中即 manual。
 */
import { normalizeFqdn } from '../../shared/values.js'
import {
  normalizeOwnershipHost,
  type OwnershipPort,
  type OwnershipTarget,
  type RecordOwnership,
} from '../../core/contracts/ownership.port.js'
import type { ProviderRepository } from '../../core/providers/provider.repository.js'
import type { EdgeOneProvider, SaaSProvider } from '../../core/providers/provider.types.js'
import type { AccelerationDomainPort } from '../../core/contracts/acceleration-domain.port.js'
import type { ZoneListPort } from '../../core/contracts/zone-list.port.js'
import type { SaaSHostnameService } from '../../modules/cloudflare/saas/saas-hostname.service.js'
import type { CloudflareCustomHostname } from '../../modules/cloudflare/saas/saas-custom-hostname.client.js'
import type { TunnelRouteService } from '../../modules/cloudflare/tunnel/tunnel-route.service.js'
import type { TunnelService } from '../../modules/cloudflare/tunnel/tunnel.service.js'

/** 一个产品线对某个 DNS 目标的主机名声明 */
export interface OwnershipSource {
  claimsFor(target: OwnershipTarget): Promise<RecordOwnership[]>
}

export class OwnershipService implements OwnershipPort {
  constructor(private readonly sources: readonly OwnershipSource[]) {}

  async claimsFor(target: OwnershipTarget): Promise<RecordOwnership[]> {
    const merged = new Map<string, RecordOwnership>()
    for (const source of this.sources) {
      for (const claim of await source.claimsFor(target)) {
        const fqdn = normalizeOwnershipHost(claim.fqdn)
        if (fqdn === '' || merged.has(fqdn)) continue
        merged.set(fqdn, { fqdn, owner: claim.owner, refId: claim.refId })
      }
    }
    return [...merged.values()]
  }
}

/** 隧道路由 → Cloudflare DNS 归属（仅 cloudflare 目标；路由读取走 provider 缓存） */
export function tunnelOwnershipSource(deps: {
  providers: ProviderRepository
  tunnels: TunnelService
  routes: TunnelRouteService
}): OwnershipSource {
  return {
    async claimsFor(target) {
      if (target.providerType !== 'cloudflare') return []
      const links = (await deps.providers.all()).filter(
        (provider) =>
          provider.type === 'cloudflared' && String(provider.cloudflare_provider ?? '') === target.providerId
      )
      const claims: RecordOwnership[] = []
      for (const link of links) {
        for (const tunnel of (await deps.tunnels.list(link.id)).items) {
          if (!tunnel.id) continue
          const config = await deps.routes.getConfig(link.id, tunnel.id)
          for (const route of config.routes) {
            if (!hostInZone(route.hostname, target.zone)) continue
            claims.push({ fqdn: route.hostname, owner: 'tunnel', refId: tunnel.id })
          }
        }
      }
      return claims
    },
  }
}

/** SaaS 主机名 → DNS 归属（主机名 + DCV 挑战 + 所有权 TXT 同属 saas） */
export function saasOwnershipSource(deps: {
  providers: ProviderRepository
  hostnames: SaaSHostnameService
}): OwnershipSource {
  return {
    async claimsFor(target) {
      const providers = (await deps.providers.all()).filter(
        (provider): provider is SaaSProvider => provider.type === 'saas' && saasTargets(provider, target)
      )
      const claims: RecordOwnership[] = []
      for (const provider of providers) {
        for (const zoneName of await zonesToScan(deps.hostnames, provider.id, target)) {
          const listed = await deps.hostnames.hostnames(provider.id, zoneName)
          for (const item of listed.items) {
            const hostname = item
            const fqdn = normalizeOwnershipHost(hostname.hostname)
            if (fqdn === '' || !hostInZone(fqdn, target.zone)) continue
            if (!hostnameTargets(hostname, target)) continue
            const refId = String(hostname.id ?? '').trim() || fqdn
            for (const name of [fqdn, `_acme-challenge.${fqdn}`, `_cf-custom-hostname.${fqdn}`]) {
              claims.push({ fqdn: name, owner: 'saas', refId })
            }
          }
        }
      }
      return claims
    },
  }
}

/** EdgeOne 加速域名 → DNSPod 归属（仅 dnspod 目标） */
export function edgeOneOwnershipSource(deps: {
  providers: ProviderRepository
  zones: ZoneListPort
  domains: AccelerationDomainPort
}): OwnershipSource {
  return {
    async claimsFor(target) {
      if (target.providerType !== 'dnspod') return []
      const providers = (await deps.providers.all()).filter(
        (provider): provider is EdgeOneProvider =>
          provider.type === 'edgeone' && String(provider.dnspod_provider ?? '') === target.providerId
      )
      const claims: RecordOwnership[] = []
      for (const provider of providers) {
        for (const zone of (await deps.zones.zones(provider.id)).items) {
          if (!zone.id) continue
          for (const domain of (await deps.domains.accelerationDomains(provider.id, zone.id)).items) {
            const fqdn = normalizeOwnershipHost(domain.name)
            if (fqdn === '' || !hostInZone(fqdn, target.zone)) continue
            claims.push({ fqdn, owner: 'edgeone', refId: fqdn })
          }
        }
      }
      return claims
    },
  }
}

/** SaaS 服务商是否可能写入该 DNS 目标（关联账号匹配） */
function saasTargets(provider: SaaSProvider, target: OwnershipTarget): boolean {
  if (target.providerType === 'dnspod') return String(provider.dnspod_provider ?? '') === target.providerId
  return (
    String(provider.cloudflare_provider ?? '') === target.providerId ||
    String(provider.cloudflare_dns_provider ?? '') === target.providerId
  )
}

/** 待扫描站点：Cloudflare 目标就是写入站点；DNSPod 目标需遍历主机名所在站点 */
async function zonesToScan(
  hostnames: SaaSHostnameService,
  providerId: string,
  target: OwnershipTarget
): Promise<string[]> {
  if (target.providerType === 'cloudflare') return [target.zone]
  const zones = await hostnames.zones(providerId)
  return zones.items
    .map((zone) => normalizeFqdn(zone.name))
    .filter((name) => name !== '' && zoneRelevant(name, target.zone))
}

/** 主机名生效同步目标是否落在该 DNS 目标上 */
function hostnameTargets(hostname: CloudflareCustomHostname, target: OwnershipTarget): boolean {
  const type = String(hostname.effective_sync_target ?? '')
  const provider = String(hostname.effective_sync_provider_id ?? '')
  if (target.providerType === 'cloudflare') return type === 'cloudflare_dns' && provider === target.providerId
  return type === 'dnspod' && provider === target.providerId
}

/** 站点名与目标站点同源（互为后缀），用于跳过无关站点 */
function zoneRelevant(zone: string, target: string): boolean {
  return hostInZone(zone, target) || hostInZone(target, zone)
}

function hostInZone(fqdn: string, zone: string): boolean {
  const host = normalizeOwnershipHost(fqdn)
  const base = normalizeOwnershipHost(zone)
  return host !== '' && base !== '' && (host === base || host.endsWith(`.${base}`))
}
