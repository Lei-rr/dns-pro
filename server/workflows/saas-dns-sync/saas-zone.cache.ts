import type { SaaSHostnameCachePort } from '../../core/contracts/saas-hostname-cache.port.js'

/**
 * 批量任务收尾：统一失效站点列表缓存（任务执行期间逐条只清详情缓存）。
 * 批量的逐条路径传 deferListInvalidation，收尾由调用方调用本函数；
 * 站点解析失败（未关联/站点不存在）只意味着无需失效，不影响已完成的远端变更。
 */
export async function invalidateSaasZoneListCache(
  hostnames: SaaSHostnameCachePort,
  providerId: string,
  zoneName: string
): Promise<void> {
  try {
    await hostnames.invalidateZoneCache(providerId, zoneName, true)
  } catch {
    // 远端变更已完成，缓存失效尽力而为
  }
}
