import { normalizeFqdn } from '../../../lib/values.js'
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

export function zoneOwnsHostname(zone: string, fqdn: string): boolean {
  const z = normalizeFqdn(zone)
  const h = normalizeFqdn(fqdn)
  if (!z || !h) return false
  return h === z || h.endsWith('.' + z)
}

/** 主机名是否已激活（可清理所有权 TXT） */
export function isHostnameActive(hostname: { status?: unknown }): boolean {
  return ['active', 'active_renewing', 'moved'].includes(String(hostname.status ?? ''))
}
