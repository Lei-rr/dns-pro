/**
 * 持久化任务类型 ID：平台层统一登记。
 * 放在一处是为了让「会写同一底层资源」的不同工作流能共享同一互斥范围。
 */

// DNS 记录批量
export const DNS_BATCH_CREATE_JOB = 'dns.batch_create'
export const DNS_BATCH_DELETE_JOB = 'dns.batch_delete'
export const DNS_BATCH_UPDATE_JOB = 'dns.batch_update'
export const DNS_ZONE_JOB_TYPES = [DNS_BATCH_CREATE_JOB, DNS_BATCH_DELETE_JOB, DNS_BATCH_UPDATE_JOB] as const

// EdgeOne 加速域名批量
export const EDGEONE_BATCH_DISABLE_JOB = 'edgeone.batch_disable'
export const EDGEONE_BATCH_DELETE_JOB = 'edgeone.batch_delete'
export const EDGEONE_ZONE_JOB_TYPES = [EDGEONE_BATCH_DISABLE_JOB, EDGEONE_BATCH_DELETE_JOB] as const

// SaaS 主机名批量与优选切换
export const SAAS_BATCH_DELETE_JOB = 'saas.batch_delete'
export const SAAS_BATCH_UPDATE_JOB = 'saas.batch_update'
export const PREFERRED_APPLY_JOB = 'saas.preferred_apply'
export const SAAS_ZONE_LOCK_MESSAGE = 'A SaaS batch or preferred-domain apply job is already running for this zone'

/**
 * 只要会写底层 DNS / 加速域名，就参与同一把资源锁：
 * DNS 批量直接写记录，SaaS 批量与优选写回关联的 DNS 服务商，EdgeOne 批量清理记录。
 */
export const ZONE_WRITE_JOB_TYPES = [
  ...DNS_ZONE_JOB_TYPES,
  ...EDGEONE_ZONE_JOB_TYPES,
  SAAS_BATCH_DELETE_JOB,
  SAAS_BATCH_UPDATE_JOB,
  PREFERRED_APPLY_JOB,
] as const

/** 底层 DNS 写入目标键；跨工作流互斥以键集合是否有交集为准 */
export function dnsZoneKey(system: 'dnspod' | 'cloudflare', providerId: string, zone: string): string {
  return `dns:${system}:${providerId}:${zone.trim().toLowerCase()}`
}

/** EdgeOne 站点级键（加速域名本身的写入目标） */
export function edgeOneZoneKey(providerId: string, zoneId: string): string {
  return `edgeone:${providerId}:${zoneId}`
}

/** 从任务 payload 读取创建时算好的资源键 */
export function readResourceKeys(payload: Record<string, unknown>): string[] {
  const keys = payload.resource_keys
  return Array.isArray(keys) ? keys.map(String) : []
}
