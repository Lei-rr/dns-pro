/**
 * 契约端口：SaaS 自定义主机名（Cloudflare for SaaS）读写与站点身份。
 *
 * workflows 只依赖本端口，不依赖 modules 内的服务类；面板端 CRUD 仍由 modules 的 handlers 直接调用模块服务。
 * 形状厂商无关：字段名为项目对外契约（HTTP 响应）里已有的归一化命名，不是 SDK 原始字段；
 * 主机名主读模型被编排显式引用故导出，其余读模型只在本文件的端口签名内命名（暂不导出），实现按结构兼容返回超集。
 */

/** 主机名 SSL 读模型：DCV 委派记录与证书设置（DCV 记录缺失时由站点级 UUID 兜底） */
interface SaaSHostnameSslValue {
  type?: string
  method?: string
  status?: string
  dcv_delegation_uuid?: string
  dcv_delegation_records?: Array<{ cname?: string; cname_target?: string }>
  settings?: Record<string, unknown>
}

/** 所有权验证读模型：TXT 记录名与值 */
interface SaaSHostnameOwnership {
  type?: string
  name?: string
  value?: string
}

/**
 * 主机名读模型：编排用它做归属取证、DNS 期望记录构造与状态展示。
 * `sync_*` 是读路径合并本地偏好后的显式配置，`effective_*` 是补全默认值、修复脏配置后的生效配置。
 */
export interface SaaSHostnameValue {
  id: string
  hostname: string
  status?: string
  custom_origin_server?: string | null
  ssl?: SaaSHostnameSslValue
  ownership_verification?: SaaSHostnameOwnership | null
  custom_metadata?: Record<string, unknown> | null
  preferred_domain?: string
  auto_preferred?: boolean
  sync_target?: string
  sync_provider_id?: string
  sync_zone?: string
  effective_sync_target?: string
  effective_sync_provider_id?: string
  effective_sync_zone?: string
  /** 远端已成功、本地偏好写入失败时的降级标记 */
  local_preference_error?: string
}

/** 站点最小读模型：归属取证与派生扫描只要站点名 */
interface SaaSHostnameZoneValue {
  id?: string | null
  name: string | null
}

/** 站点身份引用：缓存失效的标签键（关联 Cloudflare 服务商 + 站点 ID） */
interface SaaSHostnameZoneRef {
  cloudflareProviderId: string
  zoneId: string
}

export interface SaaSHostnamePort {
  /** SaaS 服务商关联的 Cloudflare 账号下站点清单（refresh 强制回源） */
  zones(providerId: string, refresh?: boolean): Promise<{ items: SaaSHostnameZoneValue[] }>
  /** 站点内主机名清单（已合并本地偏好与生效同步配置） */
  hostnames(providerId: string, zoneName: string, refresh?: boolean): Promise<{ items: SaaSHostnameValue[] }>
  /** 主机名详情；远端已不存在抛 404 saas_hostname_not_found，ID 缓存过期时自行刷新重查 */
  showHostname(
    providerId: string,
    zoneName: string,
    hostnameFqdn: string,
    refresh?: boolean
  ): Promise<SaaSHostnameValue>
  /** 创建主机名；远端成功而本地偏好失败不回滚，以 local_preference_error 降级返回 */
  createHostname(providerId: string, zoneName: string, data: Record<string, unknown>): Promise<SaaSHostnameValue>
  /** 更新主机名；remoteApplied 表示远端已应用（批量重试跳过重复 PATCH），仅刷新本地偏好 */
  updateHostname(
    providerId: string,
    zoneName: string,
    hostnameFqdn: string,
    data: Record<string, unknown>,
    options?: { remoteApplied?: boolean }
  ): Promise<SaaSHostnameValue>
  /** 删除主机名；远端已不存在时只清本地偏好并返回空 id */
  deleteHostname(providerId: string, zoneName: string, hostnameFqdn: string): Promise<{ id: string }>
  /** 站点默认回源；未设置返回 null */
  fallbackOrigin(providerId: string, zoneName: string): Promise<string | null>
  /** 优选域名白名单校验；非法抛 422 preferred_domain_not_allowed，返回归一化域名 */
  ensurePreferredDomainAllowed(value: string): Promise<string>
  /** SaaS 服务商 → 关联 Cloudflare 服务商 ID；未关联抛 422 saas_cloudflare_provider_missing */
  cloudflareProviderId(providerId: string): Promise<string>
  /** 站点名 → 站点身份；账号内无此站点抛 404 cloudflare_zone_not_found */
  resolveZoneRef(providerId: string, zoneName: string): Promise<SaaSHostnameZoneRef>
}
