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
  description?: string
  [key: string]: unknown
}

export interface ProviderDefinition {
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

export interface ApiResponse<T = unknown> {
  data: T
  meta?: Record<string, unknown>
  [key: string]: unknown
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

export interface ProviderModule {
  name: string
  providerType: string
  hook?: Record<string, unknown>
  resolveEntry: (provider: Provider) => RouteEntry | null
  resolveChild: (provider: Provider, childId: string) => RouteEntry | null
  menuEntries: (provider: Provider) => Array<{ key: string; label: string; path: string }>
  cards: (provider: Provider) => Array<Provider & Record<string, unknown>>
}
