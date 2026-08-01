/** Pure SaaS hostname helpers (no I/O) — keep SaaSHostnameService focused on orchestration. */

export function guessZoneFromFqdn(fqdn: string): string {
  const parts = fqdn.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean)
  if (parts.length < 2) return fqdn
  return parts.slice(-2).join('.')
}

/**
 * Validate fallback origin is a subdomain of zone.
 * Returns normalized value or null if invalid (caller maps to ApiError).
 */
export function tryNormalizeFallbackOrigin(zoneName: string, origin: string): string | null {
  const zone = zoneName.toLowerCase().replace(/\.$/, '').trim()
  const value = origin.toLowerCase().replace(/\.$/, '').trim()

  if (value === '' || value === zone || !value.endsWith('.' + zone)) {
    return null
  }
  return value
}

export function zoneOwnsHostname(zone: string, fqdn: string): boolean {
  const z = zone.toLowerCase().replace(/\.$/, '').trim()
  const h = fqdn.toLowerCase().replace(/\.$/, '').trim()
  if (!z || !h) return false
  return h === z || h.endsWith('.' + z)
}
