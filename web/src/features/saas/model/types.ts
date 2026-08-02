import type { SideEffects } from '@/shared/api/types'

export interface SaaSValidationRecord {
  txt_name?: string
  txt_value?: string
  http_url?: string
  http_body?: string
  status?: string
  [key: string]: unknown
}

export interface SaaSHostnameSSL {
  status?: string
  method?: string
  expires_on?: string
  issuer?: string
  settings?: Record<string, unknown>
  validation_errors?: unknown[]
  dcv_delegation_records?: Array<{ cname: string; cname_target: string }>
  dcv_delegation_uuid?: string
  validation_records?: SaaSValidationRecord[]
  [key: string]: unknown
}

export interface SaaSHostname {
  id?: string
  hostname: string
  status?: string
  ssl?: SaaSHostnameSSL
  custom_origin_server?: string
  custom_metadata?: Record<string, unknown>
  ownership_verification?: Record<string, string>
  verification_errors?: unknown[]
  auto_preferred?: boolean
  preferred_domain?: string
  sync_provider_id?: string
  sync_zone?: string
  sync_target?: string
  effective_sync_provider_id?: string
  effective_sync_zone?: string
  effective_sync_target?: string
  [key: string]: unknown
}

export interface SaaSDnsRepairResult {
  hostname: string
  side_effects: SideEffects
}

export interface SaaSFallbackOrigin {
  origin?: string
  status?: string
  errors?: unknown[]
  [key: string]: unknown
}

export interface DnsZoneOption {
  name: string
  [key: string]: unknown
}

export type SaaSSyncProvider = {
  id: string
  type: 'dnspod' | 'cloudflare'
  name: string
}
