/**
 * Shared domain contracts (ports).
 * Modules depend on these interfaces, not on concrete provider services.
 */

export type ProviderType =
  | 'dnspod'
  | 'cloudflare'
  | 'saas'
  | 'edgeone'
  | 'cloudflared'

export type Capability =
  | 'zones'
  | 'records'
  | 'saas_hostnames'
  | 'tunnel'
  | 'edge_domains'
  | 'dns_sync'

export type PageQuery = {
  page?: number
  perPage?: number
  offset?: number
  limit?: number
  keyword?: string
  refresh?: boolean
}

export type PageResult<T> = {
  items: T[]
  pagination: Record<string, unknown>
  meta?: Record<string, unknown>
}

export type SyncRecord = {
  type: string
  name: string
  value: string
  line?: string
  purpose?: string
  provider_id?: string
  remark?: string
  ttl?: number
  [key: string]: unknown
}

/** DNS zone listing/mutation port (provider-agnostic). */
export interface ZonePort {
  list(providerId: string, query?: PageQuery): Promise<PageResult<Record<string, unknown>>>
}

/** DNS record listing/mutation port. */
export interface RecordPort {
  list(providerId: string, zone: string, query?: PageQuery & Record<string, unknown>): Promise<PageResult<Record<string, unknown>>>
}

/** Cross-provider DNS sync port used by SaaS / EdgeOne / Tunnel side-effects. */
export interface SyncPort {
  syncSaasHostname(providerId: string, zoneName: string, hostnameFqdn: string): Promise<unknown>
  resyncSaasHostname(
    providerId: string,
    zoneName: string,
    hostnameFqdn: string,
    beforeRecords: SyncRecord[],
  ): Promise<unknown>
  cleanupSaasRecords(
    providerId: string,
    zoneName: string,
    hostnameFqdn: string,
    records: SyncRecord[],
  ): Promise<unknown>
  syncEdgeOneCname(edgeoneProviderId: string, domainName: string, cname: string): Promise<unknown>
  cleanupEdgeOneCname(edgeoneProviderId: string, domainName: string, cname?: string): Promise<unknown>
}

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export type JobRecord<TItem = Record<string, unknown>> = {
  id: string
  type: string
  status: JobStatus
  total: number
  done: number
  success: number
  failed: number
  skipped: number
  current?: string
  message?: string
  payload?: Record<string, unknown>
  items: TItem[]
  created_at: number
  updated_at: number
  finished_at?: number
}

export interface JobPort {
  create(type: string, payload: Record<string, unknown>, items: Array<Record<string, unknown>>): Promise<JobRecord>
  get(id: string): Promise<JobRecord | null>
  listActive(type?: string): Promise<JobRecord[]>
  patch(id: string, patch: Partial<JobRecord>): Promise<JobRecord | null>
}

export type PluginContext = {
  /** Register a service instance by token. */
  set<T>(token: string, value: T): void
  get<T>(token: string): T | undefined
  require<T>(token: string): T
}

export type AppPlugin = {
  name: string
  version?: string
  capabilities?: Capability[]
  register(ctx: PluginContext): void | Promise<void>
}

export const ServiceTokens = {
  SyncPort: 'port.sync',
  JobPort: 'port.job',
  Audit: 'svc.audit',
  Backup: 'svc.backup',
  EventBus: 'svc.events',
  DnsPodZonePort: 'port.zone.dnspod',
  DnsPodRecordPort: 'port.record.dnspod',
  CloudflareZonePort: 'port.zone.cloudflare',
  CloudflareRecordPort: 'port.record.cloudflare',
} as const
