import { ApiError } from '../http/api-error.js'
import { getProviderDefinition } from './provider-definitions.js'
import type { Provider, ProviderType } from './provider.types.js'

type ProviderLinkRule = {
  field: string
  label: string
  appliesTo: ProviderType[]
  targetType: ProviderType
}

export const PROVIDER_LINK_RULES: ProviderLinkRule[] = [
  { field: 'dnspod_provider', label: 'EdgeOne 关联 DNSPod', appliesTo: ['edgeone'], targetType: 'dnspod' },
  { field: 'cloudflare_provider', label: 'SaaS 关联 Cloudflare', appliesTo: ['saas'], targetType: 'cloudflare' },
  {
    field: 'cloudflare_dns_provider',
    label: 'SaaS Cloudflare DNS 同步',
    appliesTo: ['saas'],
    targetType: 'cloudflare',
  },
  { field: 'dnspod_provider', label: 'SaaS DNSPod 同步', appliesTo: ['saas'], targetType: 'dnspod' },
  {
    field: 'cloudflare_provider',
    label: 'Cloudflare Tunnel 关联 Cloudflare',
    appliesTo: ['cloudflared'],
    targetType: 'cloudflare',
  },
]

/** 某类型的全部关联字段规则：校验、配置判定与连通性测试共用同一事实来源 */
export function providerLinkRulesFor(type: ProviderType): ProviderLinkRule[] {
  return PROVIDER_LINK_RULES.filter((rule) => rule.appliesTo.includes(type))
}

/** 必填关联规则：字段须在 provider definition 的 required 中登记 */
export function requiredLinkRule(type: ProviderType): ProviderLinkRule | undefined {
  const definition = getProviderDefinition(type)
  if (!definition) return undefined
  return PROVIDER_LINK_RULES.find((rule) => rule.appliesTo.includes(type) && definition.required.includes(rule.field))
}

export function validateProviderReferences(candidate: Provider, providers: Provider[]): void {
  for (const rule of PROVIDER_LINK_RULES) {
    if (!rule.appliesTo.includes(candidate.type)) continue
    const targetId = String(candidate[rule.field] ?? '').trim()
    if (!targetId) continue
    const target = providers.find((provider) => provider.id === targetId)
    if (!target) {
      throw new ApiError('provider_reference_not_found', `Linked provider ${targetId} not found`, 422, {
        errors: { [rule.field]: '关联服务商不存在' },
      })
    }
    if (target.type !== rule.targetType) {
      throw new ApiError(
        'provider_reference_type_mismatch',
        `Linked provider ${targetId} must be ${rule.targetType}`,
        422,
        { errors: { [rule.field]: `关联服务商必须是 ${rule.targetType}` } }
      )
    }
  }
}
