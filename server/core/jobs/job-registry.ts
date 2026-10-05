/**
 * 任务类型 ID、底层资源键与互斥判定：平台层统一登记。
 * 放在一处是为了让「会写同一底层资源」的不同工作流共享同一互斥范围，
 * 并且只有一份判定实现——创建/重试与面板反查都走 jobConflictsWith。
 */

import { ApiError } from '../http/api-error.js'
import type { JobLock, JobRecord } from './job.types.js'

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

/** 从任务 payload 读取创建时算好的资源键；字段缺失属于装配错误，不能静默降级为「无冲突」 */
export function readResourceKeys(payload: Record<string, unknown>): string[] {
  const keys = payloadResourceKeys(payload)
  if (!keys) {
    throw new ApiError('batch_resource_keys_missing', 'Job payload is missing resource_keys', 500, {
      fields: Object.keys(payload).join(','),
    })
  }
  return keys
}

/**
 * payload 里登记的资源键：字段缺失返回 undefined，与「登记了空集合」区分开——
 * 前者说明该作业早于资源键机制（需要降级判据），后者是「本次不占用任何底层资源」的显式结论。
 */
function payloadResourceKeys(payload: Record<string, unknown> | undefined): string[] | undefined {
  const keys = payload?.resource_keys
  return Array.isArray(keys) ? keys.map(String) : undefined
}

/** 宽容读取：重试路径使用；缺失只说明无法按资源键判定，不该让重试失败 */
export function peekResourceKeys(payload: Record<string, unknown> | undefined): string[] {
  return payloadResourceKeys(payload) ?? []
}

/**
 * 「同一底层资源上已有作业在跑」的唯一判据：资源键交集。
 * 创建/重试（JobService.findActiveConflict）与面板反查（BatchJobKind.active）都调用本函数，
 * 任何一侧都不得再自建判据——历史上两处口径分叉，出现过「反查说没有作业、创建却 409」。
 * 作业没有 resource_keys（早于资源键机制的记录）时降级为 payload 同名字段相等：
 * 这类作业必须留一个更窄但确定的判据，一律当作不互斥等于对同一站点放行重复写入。
 */
export function jobConflictsWith(job: JobRecord, target: JobLock): boolean {
  const wanted = target.resourceKeys
  const existing = payloadResourceKeys(job.payload)
  // 两边都登记了资源键时以键为准：交集为空即不互斥，不再回退到字段判定
  if (wanted?.length && existing) return hasKeyIntersection(existing, wanted)
  return payloadMatchesScope(job, target.scope ?? {})
}

/** payload 同名字段相等：老作业的降级判据与详情端点的归属校验共用（undefined 值不参与判定） */
export function payloadMatchesScope(job: JobRecord, scope: Record<string, string | undefined>): boolean {
  return Object.entries(scope).every(
    ([key, value]) => value === undefined || String(job.payload?.[key] ?? '') === value
  )
}

function hasKeyIntersection(existing: readonly string[], wanted: readonly string[]): boolean {
  const target = new Set(wanted)
  return existing.some((key) => target.has(key))
}
