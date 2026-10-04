import type { CloudflareDnsRecordService } from '../../modules/cloudflare/cloudflare-dns-record.service.js'
import type { CloudflareZoneService } from '../../modules/cloudflare/cloudflare-zone.service.js'
import type { DnsPodRecordService } from '../../modules/dns-pod/dns-pod-record.service.js'
import { cloudflareCreateMatches, dnsPodCreateMatches } from './dns-record-equivalence.js'
import type { DnsBatchPort } from './dns-batch.workflow.js'

/** DNSPod：zone 即域名 */
export function dnsPodBatchPort(records: DnsPodRecordService): DnsBatchPort {
  return {
    create: (providerId, zone, data) => records.create(providerId, zone, data),
    update: (providerId, zone, recordId, data) => records.update(providerId, zone, recordId, data),
    delete: (providerId, zone, recordId) => records.delete(providerId, zone, recordId),
    async findCreated(providerId, zone, data) {
      const candidates = await records.findExact(providerId, zone, data)
      return candidates.find((record) => dnsPodCreateMatches(record, data)) ?? null
    },
  }
}

/**
 * Cloudflare：路由传入站点名，记录接口需要站点 ID。
 * 直接复用站点服务的缓存（带标签失效），避免本地永久缓存导致站点重建后仍用旧 ID。
 */
export function cloudflareBatchPort(zones: CloudflareZoneService, records: CloudflareDnsRecordService): DnsBatchPort {
  const zoneId = (providerId: string, zone: string) => zones.idByName(providerId, zone)
  return {
    create: async (providerId, zone, data) => records.create(providerId, await zoneId(providerId, zone), data),
    update: async (providerId, zone, recordId, data) =>
      records.update(providerId, await zoneId(providerId, zone), recordId, data),
    delete: async (providerId, zone, recordId) => records.delete(providerId, await zoneId(providerId, zone), recordId),
    async findCreated(providerId, zone, data) {
      const matches = await records.findExact(
        providerId,
        await zoneId(providerId, zone),
        String(data.name ?? ''),
        String(data.type ?? '')
      )
      return matches.find((record) => cloudflareCreateMatches(record, data)) ?? null
    },
  }
}
