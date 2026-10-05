/**
 * SaaS 主机名 → 期望 DNS 记录（§4.2 planner）。
 *
 * 本文件只保留扫描：遍历 SaaS 服务商 → 站点 → 主机名，解析写入目标后组装 PlannedRecord。
 * 期望记录构造在 saas-records.ts，目标解析在 saas-targets.ts；两者的原有导出在此按原样再导出，
 * 模块对外 API 与调用方不变，写入路径与对账检测仍共用同一份判据。
 */
import type { SaaSProvider } from '../../../core/providers/provider.types.js'
import { normalizeFqdn } from '../../../shared/values.js'
import type { DerivedSourcePlanner, PlannedRecord } from '../derived-record.types.js'
import { saasDesiredRecords } from './saas-records.js'
import {
  resolveEffectiveOrigin,
  resolveSaaSSyncTarget,
  type SaaSDerivedPlannerDeps,
  type SaaSDnsTarget,
} from './saas-targets.js'

export {
  CLOUDFLARE_ORIGIN_LABEL,
  DNSPOD_ORIGIN_LABEL,
  DNSPOD_PREFERRED_LINE,
  cleanupDesired,
  cloudflareDnsCleanupRecipe,
  countDeleted,
  desiredRecord,
  dnspodSaaSCleanupRecipe,
  ownershipTxtName,
  requireBusinessTarget,
  requireFqdn,
  saasDesiredRecords,
  syncRecordIdentity,
  syncRemark,
  type SaaSSyncProviderType,
  type SaaSSyncRecord,
  type SyncCollectedRecords,
} from './saas-records.js'

export {
  optionalDnsPodSaasTarget,
  resolveCloudflareSaasTarget,
  resolveDnsPodSaasTarget,
  resolveEffectiveOrigin,
  saasDefaultCloudflareProviderId,
  saasDnsPodProviderId,
  type SaaSDerivedPlannerDeps,
  type SaaSDnsPodTargetDeps,
  type SaaSSyncTargetDeps,
} from './saas-targets.js'

/** @public 对外契约：无内部引用但拆分前即已导出，必须保留（knip 会把无引用的再导出判为 unused exported types） */
export type { CloudflareSaasTarget, DnsPodSaasTargetResolution, SaaSDnsTarget } from './saas-targets.js'

/** SaaS 主机名扫描：主机名 + 生效同步目标 → 期望记录（只读） */
export function saasDerivedPlanner(deps: SaaSDerivedPlannerDeps): DerivedSourcePlanner {
  return {
    kind: 'saas-hostname',
    async scan(scope): Promise<PlannedRecord[]> {
      const records: PlannedRecord[] = []
      const providers = (await deps.providers.all()).filter(
        (provider): provider is SaaSProvider => provider.type === 'saas'
      )
      for (const provider of providers) {
        if (scope.providerId && !saasScopeMatches(provider, scope.providerId)) continue
        for (const zone of (await deps.hostnames.zones(provider.id)).items) {
          if (!zone.name) continue
          const listed = await deps.hostnames.hostnames(provider.id, zone.name)
          for (const item of listed.items) {
            const hostname = item
            const fqdn = normalizeFqdn(hostname.hostname)
            if (fqdn === '') continue
            const target = await resolveSaaSSyncTarget(deps, provider.id, hostname, fqdn, zone.name).catch(
              (): SaaSDnsTarget | null => null
            )
            // 目标不可解析（未关联服务商 / 无匹配域名）：跳过，不算漂移
            if (!target) continue
            const origin = await resolveEffectiveOrigin(deps.hostnames, provider.id, zone.name, hostname)
            for (const desired of saasDesiredRecords({
              hostname,
              providerType: target.providerType,
              providerId: target.providerId,
              zone: target.zone,
              origin,
            })) {
              records.push({
                source: { kind: 'saas-hostname', providerId: provider.id, id: String(hostname.id ?? '') || fqdn },
                target: {
                  providerType: target.providerType,
                  providerId: target.providerId,
                  zone: target.zone,
                  fqdn: desired.fqdn,
                },
                owner: 'saas',
                purpose: desired.purpose,
                desired,
              })
            }
          }
        }
      }
      return records
    },
  }
}

/** scope.providerId 命中 SaaS 服务商自身或其关联的 DNS / Cloudflare 服务商 */
function saasScopeMatches(provider: SaaSProvider, providerId: string): boolean {
  return [provider.id, provider.cloudflare_provider, provider.cloudflare_dns_provider, provider.dnspod_provider].some(
    (value) => String(value ?? '') === providerId
  )
}
