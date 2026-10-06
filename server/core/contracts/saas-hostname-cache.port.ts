/**
 * 契约端口：SaaS 主机名缓存失效。
 *
 * 写路径在远端变更提交后调用（创建/更新/删除、批量任务收尾），属内存操作、不产生上游请求。
 * 与读写端口拆开：只有写路径的收尾消费该能力，读路径与归属取证完全不关心缓存。
 *
 * 失效范围按意图拆成独立入口，而不是一个沿层传递的布尔：批量任务逐条写只失效详情，
 * 列表缓存留到任务收尾统一失效（否则每一条都要重新分页拉取整站主机名，O(N²) 上游放大）。
 */

export interface SaaSHostnameCachePort {
  /** 只失效主机名详情缓存（批量任务逐条写后调用） */
  invalidateHostnameDetails(cloudflareProviderId: string, zoneId: string): void
  /** 同时失效主机名详情与站点主机名列表缓存（单条写路径） */
  invalidateHostnameAndList(cloudflareProviderId: string, zoneId: string): void
  /**
   * 按 SaaS 服务商 + 站点名解析站点后，同时失效详情与列表缓存（批量任务收尾）。
   * 解析失败（未关联/站点不存在）会抛出，是否静默由调用方决定（收尾路径通常尽力而为）。
   */
  invalidateZoneHostnameAndList(providerId: string, zoneName: string): Promise<void>
}
