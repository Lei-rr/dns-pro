/**
 * 契约端口：SaaS 主机名的同步配置解析。
 *
 * 拆成两个接口的依据是数据来源不同：主机名配置依赖主机名身份（先查本地偏好，必要时回源解析主机名），
 * 服务商默认值只看服务商记录上的关联字段；两者被拆开是为了让只读默认值的调用方（资源互斥、目标解析兜底）
 * 不被迫依赖主机名身份解析。写入路径与对账扫描共用同一判据，避免两套语义漂移。
 * 读模型只在本文件的端口签名内命名（暂不导出），实现按结构兼容返回超集。
 */
import { ApiError } from '../http/api-error.js'
import { toText } from '../../shared/values.js'

/**
 * SaaS 同步目标：DNSPod / Cloudflare DNS；空串表示未配置（读取时由服务商默认值补全）。
 * 词表与 providerType 不同（'cloudflare_dns' ≠ 'cloudflare'），闭合后两套词表不会再互相混用。
 */
export type SyncTarget = 'dnspod' | 'cloudflare_dns' | ''

/**
 * 解析同步目标：JSON 偏好与请求体里的取值都先过这里。
 * 未知值显式 422 而不是静默回落到 DNSPod——否则写入目标与归属判据会分叉（写错厂商账号）。
 */
export function parseSyncTarget(value: unknown): SyncTarget {
  const target = toText(value)
  if (target === '' || target === 'dnspod' || target === 'cloudflare_dns') return target
  return invalidSyncTarget(target)
}

/** 判别键穷尽自检：switch 覆盖全部成员后 default 分支才可传入 never；未知值只可能来自绕过类型的运行时数据 */
export function unsupportedSyncTarget(value: never): never {
  return invalidSyncTarget(String(value))
}

function invalidSyncTarget(target: string): never {
  throw new ApiError('saas_sync_target_invalid', `Unsupported SaaS sync target: ${target}`, 422, {
    sync_target: target,
  })
}

/** 显式同步配置读模型（本地保存的配置，字段为对外契约的归一化命名） */
interface SaaSSyncConfigValue {
  hostname: string
  sync_target: SyncTarget
  sync_provider_id: string
  sync_zone: string
  auto_preferred: boolean
}

/** 生效配置：显式配置 + 服务商默认值 + 脏数据修复；explicit 表示用户显式提交过 */
type SaaSEffectiveSyncConfigValue = SaaSSyncConfigValue & { explicit: boolean }

/** 主机名同步配置：按 FQDN 优先命中本地偏好，避免为读配置回源 */
export interface SaaSSyncConfigPort {
  /** 显式（本地保存的）同步配置；未知站点时按 FQDN 遍历站点兜底 */
  syncConfig(providerId: string, hostnameFqdn: string, zoneName?: string): Promise<SaaSSyncConfigValue>
  /** 生效的同步配置（默认值补全 + 脏配置修复） */
  effectiveSyncConfig(
    providerId: string,
    hostnameFqdn: string,
    zoneName?: string
  ): Promise<SaaSEffectiveSyncConfigValue>
}

/** 服务商默认同步目标：只看服务商关联字段，不读主机名偏好 */
export interface SaaSSyncDefaultsPort {
  /** 默认同步目标：配置了 DNSPod 优先，否则 Cloudflare DNS；都未关联返回空串 */
  defaultSyncTarget(providerId: string): Promise<SyncTarget>
  /** 目标对应的默认同步服务商 ID；目标未关联服务商返回空串 */
  defaultSyncProviderId(providerId: string, target: SyncTarget): Promise<string>
}
