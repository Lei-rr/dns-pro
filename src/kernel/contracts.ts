/**
 * dns-pro Kernel contracts — FROZEN public surface.
 *
 * Rules:
 * - New business features extend via modules + ServiceTokens, not by rewriting this file.
 * - Prefer additive changes (new optional fields / new tokens). Breaking changes need major version.
 * - Controllers depend on ports/usecases registered in the registry, not on sibling modules.
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
  | 'jobs'
  | 'system'

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

/** DNS zone listing port (provider-agnostic). */
export interface ZonePort {
  list(providerId: string, query?: PageQuery): Promise<PageResult<Record<string, unknown>>>
}

/** DNS record listing port. */
export interface RecordPort {
  list(
    providerId: string,
    zone: string,
    query?: PageQuery & Record<string, unknown>,
  ): Promise<PageResult<Record<string, unknown>>>
}

/** Cross-provider DNS sync used by SaaS / EdgeOne / Tunnel side-effects. */
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
  create(
    type: string,
    payload: Record<string, unknown>,
    items: Array<Record<string, unknown>>,
    options?: { start?: boolean; message?: string },
  ): Promise<JobRecord>
  get(id: string): Promise<JobRecord | null>
  listActive(type?: string): Promise<JobRecord[]>
  patch(id: string, patch: Partial<JobRecord>): Promise<JobRecord | null>
  resumeActiveJobs?(): Promise<number>
  stats?(): Promise<{ total: number; active: number; finished: number }>
}

/** DI / plugin registration context — stable for all modules. */
export type PluginContext = {
  set<T>(token: string, value: T): void
  get<T>(token: string): T | undefined
  require<T>(token: string): T
  has(token: string): boolean
}

/**
 * Kernel plugin (DI-only). Prefer ModuleDefinition for full modules.
 * Kept for platform internals and gradual migration.
 */
export type AppPlugin = {
  name: string
  version?: string
  capabilities?: Capability[]
  register(ctx: PluginContext): void | Promise<void>
}

/**
 * Canonical module definition (Nest/Fastify-plugin style, YAGNI).
 *
 * A module may provide:
 * - register: DI tokens, ports, job runners
 * - publicRoutes: unauthenticated HTTP under /api/v1
 * - routes: authenticated HTTP under /api/v1
 *
 * Adding a provider = add a folder + export ModuleDefinition + list it in compose/modules.ts.
 * Kernel stays untouched.
 */
export type ModuleDefinition = {
  name: string
  version?: string
  capabilities?: Capability[]
  /** Optional DI / runners / ports */
  register?: (ctx: PluginContext) => void | Promise<void>
  /** Unauthenticated routes (rare: health, login) */
  publicRoutes?: (app: import('fastify').FastifyInstance) => Promise<void> | void
  /** Authenticated routes (default business surface) */
  routes?: (app: import('fastify').FastifyInstance) => Promise<void> | void
}

export function defineModule(mod: ModuleDefinition): ModuleDefinition {
  if (!mod.name?.trim()) {
    throw new Error('defineModule: name is required')
  }
  return mod
}

/** Well-known service tokens. Add new tokens only when a shared port is real. */
export const ServiceTokens = {
  SyncPort: 'port.sync',
  JobPort: 'port.job',
  Audit: 'svc.audit',
  EventBus: 'svc.events',
  DnsPodZonePort: 'port.zone.dnspod',
  DnsPodRecordPort: 'port.record.dnspod',
  CloudflareZonePort: 'port.zone.cloudflare',
  CloudflareRecordPort: 'port.record.cloudflare',
} as const

export type ServiceToken = (typeof ServiceTokens)[keyof typeof ServiceTokens]
