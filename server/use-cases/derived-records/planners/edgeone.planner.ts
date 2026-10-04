/**
 * EdgeOne 加速域名 → 期望 DNS 记录（§4.2 planner）。
 *
 * 加速域名是来源，关联 DNSPod 账号下的 CNAME 是派生投影。
 * 期望记录构造同时被 EdgeOne 同步工作流复用（写入与对账同一判据）。
 */
import { normalizeFqdn } from '../../../shared/values.js'
import type { ProviderRepository } from '../../../core/providers/provider.repository.js'
import type { EdgeOneProvider } from '../../../core/providers/provider.types.js'
import { DNSPOD_DEFAULT_LINE } from '../../../modules/dnspod/dns-pod-record.service.js'
import type { DnsPodZoneCatalog } from '../../../modules/dnspod/zone-catalog.js'
import type { EdgeOneDomainService } from '../../../modules/edgeone/edge-one-domain.service.js'
import type { EdgeOneZoneService } from '../../../modules/edgeone/edge-one-zone.service.js'
import type { DerivedSourcePlanner, PlannedRecord } from '../derived-record.types.js'
import type { DesiredRecord } from '../sync-plan.js'

/** EdgeOne 同步解析的 TTL 默认值 */
const EDGEONE_CNAME_TTL = 600

/** EdgeOne CNAME 期望记录（同步写入与对账检测共用同一判据） */
export function edgeOneCnameDesired(fqdn: string, cname: string): DesiredRecord {
  return {
    purpose: 'edgeone_cname',
    fqdn,
    owner: 'edgeone',
    refId: fqdn,
    record: {
      type: 'CNAME',
      value: cname,
      line: DNSPOD_DEFAULT_LINE,
      note: `EdgeOne 加速丨${fqdn}`,
      ttl: EDGEONE_CNAME_TTL,
    },
  }
}

/** EdgeOne 加速域名扫描：站点 → 加速域名 → 分配的 CNAME → DNSPod 记录（只读） */
export function edgeOneDerivedPlanner(deps: {
  providers: ProviderRepository
  zones: EdgeOneZoneService
  domains: EdgeOneDomainService
  catalog: DnsPodZoneCatalog
}): DerivedSourcePlanner {
  return {
    kind: 'edgeone-domain',
    async scan(scope): Promise<PlannedRecord[]> {
      const records: PlannedRecord[] = []
      const providers = (await deps.providers.all()).filter(
        (provider): provider is EdgeOneProvider => provider.type === 'edgeone'
      )
      for (const provider of providers) {
        const dnspodProviderId = String(provider.dnspod_provider ?? '')
        if (dnspodProviderId === '') continue
        if (scope.providerId && scope.providerId !== provider.id && scope.providerId !== dnspodProviderId) continue
        for (const zone of (await deps.zones.zones(provider.id)).items) {
          if (!zone.id) continue
          for (const domain of (await deps.domains.accelerationDomains(provider.id, zone.id)).items) {
            const fqdn = normalizeFqdn(domain.name)
            if (fqdn === '') continue
            // 尚未分配 CNAME 的加速域名没有派生目标，跳过（不算漂移）
            const cname = await deps.domains.assignedCname(provider.id, zone.id, fqdn).catch(() => '')
            if (cname === '') continue
            const dnspodZone = await deps.catalog.resolve(dnspodProviderId, fqdn, 'edgeone').catch(() => '')
            if (dnspodZone === '') continue
            const desired = edgeOneCnameDesired(fqdn, cname)
            records.push({
              source: { kind: 'edgeone-domain', providerId: provider.id, id: fqdn },
              target: { providerType: 'dnspod', providerId: dnspodProviderId, zone: dnspodZone, fqdn },
              owner: 'edgeone',
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
