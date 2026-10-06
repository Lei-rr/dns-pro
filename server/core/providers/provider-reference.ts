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

/** 关联目标的失败形态：details 由调用方按场景补充 */
export type LinkTargetFailure = { kind: 'missing' } | { kind: 'type_mismatch'; actualType: ProviderType }

/**
 * 关联目标断言：目标不存在或类型不符时抛出同一对错误码与文案。
 * 取数方式（内存列表 / repository）与 details 形状由调用方决定。
 */
export function assertLinkTarget(
  candidate: Provider | null | undefined,
  id: string,
  expectedType: ProviderType,
  details: (failure: LinkTargetFailure) => Record<string, unknown>
): void {
  if (!candidate) {
    throw new ApiError(
      'provider_reference_not_found',
      `Linked provider ${id} not found`,
      422,
      details({ kind: 'missing' })
    )
  }
  if (candidate.type !== expectedType) {
    throw new ApiError(
      'provider_reference_type_mismatch',
      `Linked provider ${id} must be ${expectedType}, got ${candidate.type}`,
      422,
      details({ kind: 'type_mismatch', actualType: candidate.type })
    )
  }
}

export function validateProviderReferences(candidate: Provider, providers: Provider[]): void {
  for (const rule of PROVIDER_LINK_RULES) {
    if (!rule.appliesTo.includes(candidate.type)) continue
    const targetId = String(candidate[rule.field] ?? '').trim()
    if (!targetId) continue
    const target = providers.find((provider) => provider.id === targetId)
    assertLinkTarget(target, targetId, rule.targetType, (failure) => ({
      errors: {
        [rule.field]: failure.kind === 'missing' ? '关联服务商不存在' : `关联服务商必须是 ${rule.targetType}`,
      },
    }))
  }
}
