/**
 * SaaS 主机名 → 期望 DNS 记录（§4.2 planner）。
 *
 * 期望记录构造在 saas-records.planner.ts，目标解析在 saas-targets.planner.ts；两者的原有导出在此按原样再导出，
 * 模块对外 API 与调用方不变。
 */

export {
  CLOUDFLARE_ORIGIN_LABEL,
  CLOUDFLARE_RECORD_TTL,
  DNSPOD_DEFAULT_LINE,
  DNSPOD_ORIGIN_LABEL,
  DNSPOD_PREFERRED_LINE,
  DNSPOD_RECORD_TTL,
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
} from './saas-records.planner.js'

export {
  optionalDnsPodSaasTarget,
  resolveCloudflareSaasTarget,
  resolveDnsPodSaasTarget,
  resolveEffectiveOrigin,
  saasDefaultCloudflareProviderId,
  saasDnsPodProviderId,
  type SaaSDnsPodTargetDeps,
  type SaaSSyncTargetDeps,
  type SaaSPlannerHostnames,
} from './saas-targets.planner.js'

/** @public 对外契约：无内部引用但拆分前即已导出，必须保留（knip 会把无引用的再导出判为 unused exported types） */
export type { CloudflareSaasTarget, DnsPodSaasTargetResolution, SaaSDnsTarget } from './saas-targets.planner.js'
