import type { SyncRecord } from './types.js'

/** Standard CF-for-SaaS DNS cleanup recipe when the custom hostname is already gone. */

export function cloudflareDnsCleanupRecipe(
  fqdn: string,
  providerId: string,
  zoneName: string,
): SyncRecord[] {
  return [
    { type: 'CNAME', name: fqdn, value: '', purpose: 'origin_cname', provider_id: providerId, zone_name: zoneName },
    {
      type: 'CNAME',
      name: `_acme-challenge.${fqdn}`,
      value: '',
      purpose: 'dcv_delegation',
      provider_id: providerId,
      zone_name: zoneName,
    },
    {
      type: 'TXT',
      name: `_cf-custom-hostname.${fqdn}`,
      value: '',
      purpose: 'ownership_verification',
      provider_id: providerId,
      zone_name: zoneName,
    },
  ]
}

export function dnspodSaasCleanupRecipe(
  fqdn: string,
  dnspodProviderId: string,
  dnspodZone: string,
): SyncRecord[] {
  return [
    {
      type: 'CNAME',
      name: fqdn,
      value: '',
      purpose: 'origin_cname',
      provider_id: dnspodProviderId,
      line: '默认',
      dnspod_zone: dnspodZone,
    },
    {
      type: 'CNAME',
      name: fqdn,
      value: '',
      purpose: 'preferred_cname',
      provider_id: dnspodProviderId,
      line: '境内',
      dnspod_zone: dnspodZone,
    },
    {
      type: 'CNAME',
      name: `_acme-challenge.${fqdn}`,
      value: '',
      purpose: 'dcv_delegation',
      provider_id: dnspodProviderId,
      line: '默认',
      dnspod_zone: dnspodZone,
    },
    {
      type: 'TXT',
      name: `_cf-custom-hostname.${fqdn}`,
      value: '',
      purpose: 'ownership_verification',
      provider_id: dnspodProviderId,
      line: '默认',
      dnspod_zone: dnspodZone,
    },
  ]
}
