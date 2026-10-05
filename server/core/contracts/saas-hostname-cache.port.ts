/**
 * 契约端口：SaaS 主机名缓存失效。
 *
 * 写路径在远端变更提交后调用（创建/更新/删除、批量任务收尾），属内存操作、不产生上游请求。
 * 与读写端口拆开：只有写路径的收尾消费该能力，读路径与归属取证完全不关心缓存；
 * 批量任务逐条只失效详情、收尾才失效列表（否则每一条都要重新分页拉取整站主机名）。
 */

export interface SaaSHostnameCachePort {
  /** 按站点身份失效；includeList=false 时只失效详情（批量逐条用） */
  invalidateHostnameCache(cloudflareProviderId: string, zoneId: string, includeList: boolean): void
  /**
   * 按 SaaS 服务商 + 站点名解析站点后失效。
   * 解析失败（未关联/站点不存在）会抛出，是否静默由调用方决定（收尾路径通常尽力而为）。
   */
  invalidateZoneCache(providerId: string, zoneName: string, includeList: boolean): Promise<void>
}
