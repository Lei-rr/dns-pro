import { normalizeFqdn } from '../../../shared/values.js'
import type { SaaSHostnameOwnership } from '../../../core/contracts/saas-hostname-rules.port.js'
/** Pure SaaS hostname helpers (no I/O) — keep SaaSHostnameService focused on orchestration. */

/**
 * 猜一个候选站点名：去掉最左一个标签。
 * 只作默认值用（真实站点由服务商域名列表做最长后缀匹配），
 * 因此不能像旧实现那样固定取最后两段——那会把 `example.co.uk` 猜成 `co.uk`。
 */
export function guessZoneFromFqdn(fqdn: string): string {
  const parts = normalizeFqdn(fqdn).split('.').filter(Boolean)
  return parts.length < 2 ? '' : parts.slice(1).join('.')
}

/**
 * Validate fallback origin is a subdomain of zone.
 * Returns normalized value or null if invalid (caller maps to ApiError).
 */
export function tryNormalizeFallbackOrigin(zoneName: string, origin: string): string | null {
  const zone = normalizeFqdn(zoneName)
  const value = normalizeFqdn(origin)

  if (value === '' || value === zone || !value.endsWith('.' + zone)) {
    return null
  }
  return value
}

/**
 * 站点是否托管该主机名（同名或为其子域）。
 * 参数用对象承载：该判定被读接口 / DNS 写回 / 归属查询共用，位置参数写反只会静默判负。
 */
export function zoneOwnsHostname(host: SaaSHostnameOwnership): boolean {
  const zone = normalizeFqdn(host.zone)
  const fqdn = normalizeFqdn(host.fqdn)
  if (!zone || !fqdn) return false
  return fqdn === zone || fqdn.endsWith('.' + zone)
}

/**
 * 生效的优选域名：本地偏好 → 顶层字段 → custom_metadata。
 *
 * 三个来源顺序必须唯一：合并写入侧（mergePreference）、派生记录侧（saas.planner）与前端
 * （use-saas-host-editor）各写一遍顺序时，同一条主机名会出现「读接口说 A、DNS 写回用 B」。
 * 顶层字段优先于 custom_metadata：合并后的顶层即最终值，远端元数据只作未合并时的兜底。
 */
export function effectivePreferredDomain(
  hostname: { preferred_domain?: unknown; custom_metadata?: unknown },
  preference?: { preferred_domain?: unknown } | null
): string {
  const local = String(preference?.preferred_domain ?? '').trim()
  const metadata = hostname.custom_metadata as Record<string, unknown> | null | undefined
  return local || String(hostname.preferred_domain ?? '').trim() || String(metadata?.preferred_domain ?? '').trim()
}

/**
 * 主机名是否仍在管理内（可清理所有权 TXT）。
 * `moved` 表示主机名已迁出本站点：既不算在管，也不能清掉所有权 TXT（清理后无法再次验证归属）。
 */
export function isHostnameActive(hostname: { status?: unknown }): boolean {
  return ['active', 'active_renewing'].includes(String(hostname.status ?? ''))
}
