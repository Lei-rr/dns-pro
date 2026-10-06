import type { SaaSHostnameCachePort } from '../../core/contracts/saas-hostname-cache.port.js'

/**
 * 批量任务收尾：统一失效站点主机名缓存（详情 + 列表；任务执行期间逐条只清详情）。
 * 逐条路径只调用 invalidateHostnameDetails/invalidateHostnameAndList，收尾由调用方调用本函数；
 * 站点解析失败（未关联/站点不存在）只意味着无需失效，不影响已完成的远端变更。
 */
export async function invalidateSaasZoneHostnameCaches(
  hostnames: SaaSHostnameCachePort,
  providerId: string,
  zoneName: string
): Promise<void> {
  try {
    await hostnames.invalidateZoneHostnameAndList(providerId, zoneName)
  } catch {
    // 远端变更已完成，缓存失效尽力而为
  }
}
