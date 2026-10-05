import type { SaaSHostnameService } from '../../modules/cloudflare/saas/saas-hostname.service.js'
import { invalidateSaaSHostnameCache } from '../../modules/cloudflare/saas/saas.cache.js'

/**
 * 批量任务收尾：统一失效站点列表缓存（任务执行期间逐条只清详情缓存）。
 * 批量的逐条路径传 deferListInvalidation，收尾由调用方调用本函数。
 */
export async function invalidateSaasZoneListCache(
  hostnames: SaaSHostnameService,
  providerId: string,
  zoneName: string
): Promise<void> {
  try {
    const zone = await hostnames.resolveZoneRef(providerId, zoneName)
    invalidateSaaSHostnameCache(zone.cloudflareProviderId, zone.zoneId, true)
  } catch {
    // 远端变更已完成，缓存失效尽力而为
  }
}
