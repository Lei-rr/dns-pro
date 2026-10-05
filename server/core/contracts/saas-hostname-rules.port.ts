/**
 * 契约端口：主机名判定规则（同一条主机名在各路径给出同一结论）。
 *
 * 生效优选域名的取值顺序、在管状态、站点归属三处判据被「面板展示」「DNS 写回」「一键切换」共用：
 * 各自重写会让同一条主机名出现「读接口说 A、写回用 B」的分叉，因此统一由本端口提供，实现委派模块内纯函数。
 * 状态取值（active / active_renewing）与优选域名来源（顶层字段 / custom_metadata）属厂商语义，故不落在本层。
 */

/** 优选域名取值来源：主机名（顶层字段优先，custom_metadata 兜底） */
interface SaaSPreferredDomainSource {
  preferred_domain?: unknown
  custom_metadata?: unknown
}

export interface SaaSHostnameRulesPort {
  /** 生效优选域名：本地偏好 → 顶层字段 → custom_metadata（顺序唯一） */
  effectivePreferredDomain(
    hostname: SaaSPreferredDomainSource,
    preference?: { preferred_domain?: unknown } | null
  ): string
  /** 主机名是否仍在管理内（active / active_renewing）；moved 已迁出，不得清理所有权 TXT */
  isHostnameActive(hostname: { status?: unknown }): boolean
  /** 站点是否托管该主机名（同名或为其子域） */
  zoneOwnsHostname(zone: string, fqdn: string): boolean
}
