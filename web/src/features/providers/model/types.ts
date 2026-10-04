// 契约来源：后端 presenter 的输出类型直接引用（type-only，构建期擦除）
import type { PresentedProvider } from '@server/core/providers/provider.types.js'

export interface Provider extends PresentedProvider {
  dependencies?: Array<{ reason?: string; name?: string; id?: string }>
  dnspod_provider?: string
  cloudflare_provider?: string
  cloudflare_dns_provider?: string
  description?: string
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
