export interface Provider {
  id: string
  type: 'dnspod' | 'cloudflare' | 'saas' | 'edgeone' | 'cloudflared'
  name: string
  configured: boolean
  editable_fields: string[]
  fields: Record<string, string>
  dependencies?: Array<{ reason?: string; name?: string; id?: string }>
  dnspod_provider?: string
  cloudflare_provider?: string
  cloudflare_dns_provider?: string
  description?: string
  [key: string]: unknown
}

export interface ProviderDefinition {
  [key: string]: unknown
  type: string
  name: string
  fields: string[]
  required: string[]
  labels?: Record<string, string>
}

export interface ProviderDefinitions {
  types: ProviderDefinition[]
  labels: Record<string, string>
}

export interface Zone {
  id?: string
  name: string
  status?: string
  access_status?: string
  dns_status?: string
  provider?: string
  provider_type?: string
  provider_name?: string
  name_servers?: string[]
  effective_dns?: string[]
  active_status?: string
  area?: string
  type?: string
  [key: string]: unknown
}

export interface DnsRecord {
  id?: string
  name?: string
  type?: string
  value?: string
  content?: string
  ttl?: number | string
  priority?: number | string
  mx?: number | string
  line?: string
  record_line?: string
  record_line_id?: string
  line_id?: string
  remark?: string
  comment?: string
  proxied?: boolean
  subdomain?: string
  record_type?: string
  provider?: string
  provider_type?: string
  fqdn?: string
  status?: string
  [key: string]: unknown
}

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
  [key: string]: unknown
}

export interface SaaSFallbackOrigin {
  origin?: string
  status?: string
  errors?: unknown[]
  [key: string]: unknown
}

export interface EdgeOneOrigin {
  type?: string
  value?: string
  host_header?: string
  [key: string]: unknown
}

export interface EdgeOneCertificateItem {
  cert_id?: string
  status?: string
  type?: string
  expire_time?: string
  [key: string]: unknown
}

export interface EdgeOneCertificate {
  mode?: string
  items?: EdgeOneCertificateItem[]
  list?: EdgeOneCertificateItem[]
  [key: string]: unknown
}

export interface EdgeOneAccelerationDomain {
  name?: string
  domain_name?: string
  status?: string
  cname?: string
  origin?: EdgeOneOrigin
  origin_protocol?: string
  origin_type?: string
  http_origin_port?: number
  https_origin_port?: number
  ipv6_status?: string
  certificate?: EdgeOneCertificate
  [key: string]: unknown
}

export interface EdgeOneZone {
  id?: string
  name?: string
  area?: string
  type?: string
  status?: string
  active_status?: string
  [key: string]: unknown
}

export interface CloudflaredTunnelConnection {
  id?: string
  client_id?: string
  client_version?: string
  colo_name?: string
  origin_ip?: string
  opened_at?: string
  is_pending_reconnect?: boolean
  [key: string]: unknown
}

export interface CloudflaredTunnel {
  id?: string
  name?: string
  status?: string
  connections?: CloudflaredTunnelConnection[]
  created_at?: string
  conns_active_at?: string
  [key: string]: unknown
}

export interface CloudflaredRoute {
  hostname?: string
  service?: string
  path?: string
  [key: string]: unknown
}

export interface DnsSideEffect {
  status?: string
  message?: string
  details?: { cleaned?: number; [key: string]: unknown }
  [key: string]: unknown
}

export interface SideEffects {
  dns?: {
    sync?: DnsSideEffect
    cleanup?: DnsSideEffect
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface ApiSuccessResponse<T = unknown> {
  code: 0
  message: 'success'
  data: T
  meta?: Record<string, unknown>
  side_effects?: SideEffects
  [key: string]: unknown
}

export interface ApiErrorResponse {
  message: string
  code: string
  status: number
  details?: unknown
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T>

export interface ListResponse<T> {
  [key: string]: unknown
  items: T[]
  meta?: Record<string, unknown>
  pagination?: Record<string, unknown>
}

export interface RouteEntry {
  type: string
  id: string
  provider: Provider
  childId?: string
  childType?: string
  component: unknown
  props?: Record<string, unknown>
}

export interface RecordLine {
  label: string
  value: string
  [key: string]: unknown
}

export interface ZoneStatusColumn {
  key: string
  title: string
  width?: number
  getStatus?: (record: Zone) => unknown
  [key: string]: unknown
}

export interface ProviderHookCapabilities {
  createZone: boolean
  deleteZone: boolean
  importRecords: boolean
  exportRecords: boolean
}

export interface ProviderHook {
  capabilities: ProviderHookCapabilities
  showTtl: boolean
  lineLabel: string
  proxyLabel: string
  proxyOnText: string
  proxyOffText: string
  proxyOnColor: string
  proxyOffColor: string
  proxyTypes: string[]
  recordLines: RecordLine[]
  showLine: (lines: RecordLine[]) => boolean
  zoneStatusColumns: ZoneStatusColumn[]
  zoneStatusLabel: (status: unknown) => string
  zoneStatusColor: (status: unknown) => string
}

export interface ProviderCard extends Provider {
  path?: string
  description?: string
  tag?: string
  color?: string
  avatarColor?: string
  [key: string]: unknown
}

export interface ProviderModule {
  name: string
  providerType: string
  hook?: ProviderHook
  resolveEntry: (provider: Provider) => RouteEntry | null
  resolveChild: (provider: Provider, childId: string) => RouteEntry | null
  menuEntries: (provider: Provider) => Array<{ key: string; label: string; path: string }>
  cards: (provider: Provider) => ProviderCard[]
}
