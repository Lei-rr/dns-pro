/**
 * D4 端口：hostname 级归属查询。
 *
 * 归属不落盘、不手工维护：由派生关系（SaaS 主机名 / 隧道 Ingress 路由 / EdgeOne 加速域名）
 * 在查询时解析。未被任何派生关系声明的主机名一律视为 manual（人工记录，绝不自动删）。
 */
import { normalizeFqdn } from '../../shared/values.js'
import type { DnsProviderType } from './dns-record.port.js'

export type RecordOwner = 'saas' | 'tunnel' | 'edgeone' | 'manual'

/** 派生关系声明的归属（manual 是"没有派生关系"的默认值，不能被声明） */
export type DerivedOwner = Exclude<RecordOwner, 'manual'>

export interface RecordOwnership {
  fqdn: string
  owner: DerivedOwner
  /** 派生来源标识：主机名 ID / 加速域名 / 隧道 ID */
  refId: string
}

export interface OwnershipTarget {
  providerType: DnsProviderType
  providerId: string
  zone: string
}

export interface OwnershipPort {
  /** 指定 DNS 目标下由派生关系声明归属的主机名（不含 manual） */
  claimsFor(target: OwnershipTarget): Promise<RecordOwnership[]>
}

/**
 * 主机名归一：小写、去空白、去全部尾点。
 * 注意比 shared/values 的 normalizeFqdn（只去一个尾点）更严格，`a.com..` 与 `a.com` 视为同一主机。
 */
export function normalizeOwnershipHost(value: unknown): string {
  return normalizeFqdn(value).replace(/\.+$/, '')
}

/**
 * 主机名 → 声明列表的索引，按 claims 数组实例缓存。
 * 写流水线会拿同一批 claims 逐个目标主机名查询，不建索引就是 O(目标数 × claims数) 的重复归一；
 * 约定：claims 数组构造完成后不再原地修改（调用方每次查询都重新构造）。
 */
const claimIndexes = new WeakMap<readonly RecordOwnership[], Map<string, RecordOwnership[]>>()

function indexClaims(claims: readonly RecordOwnership[]): Map<string, RecordOwnership[]> {
  const cached = claimIndexes.get(claims)
  if (cached) return cached
  const index = new Map<string, RecordOwnership[]>()
  for (const claim of claims) {
    const host = normalizeOwnershipHost(claim.fqdn)
    if (host === '') continue
    const bucket = index.get(host)
    if (bucket) bucket.push(claim)
    else index.set(host, [claim])
  }
  claimIndexes.set(claims, index)
  return index
}

/** 主机名归属：未命中派生关系 → manual */
export function ownerOf(claims: readonly RecordOwnership[], fqdn: string): { owner: RecordOwner; refId: string } {
  const host = normalizeOwnershipHost(fqdn)
  if (host === '') return { owner: 'manual', refId: '' }
  const claim = indexClaims(claims).get(host)?.[0]
  return claim ? { owner: claim.owner, refId: claim.refId } : { owner: 'manual', refId: '' }
}

/** 指定主机名上是否存在与 declared 冲突的派生归属（同名被其它产品线占用） */
export function ownershipConflict(
  claims: readonly RecordOwnership[],
  fqdn: string,
  declared: DerivedOwner
): RecordOwnership | null {
  const host = normalizeOwnershipHost(fqdn)
  if (host === '') return null
  return (
    indexClaims(claims)
      .get(host)
      ?.find((item) => item.owner !== declared) ?? null
  )
}
