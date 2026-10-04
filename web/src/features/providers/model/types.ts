type ProviderType = 'dnspod' | 'cloudflare' | 'saas' | 'edgeone' | 'cloudflared'

export interface Provider {
  id: string
  type: ProviderType
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
  /** 后端声明为密钥的字段：仅这些字段隐藏原值 */
  secret_fields: string[]
  labels?: Record<string, string>
}

export interface ProviderDefinitions {
  types: ProviderDefinition[]
  labels: Record<string, string>
}
