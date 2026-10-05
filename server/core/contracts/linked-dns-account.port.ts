/**
 * 契约端口：产品线服务商 → 关联 DNS 账号 的解析（D3-2 底座）。
 *
 * EdgeOne / SaaS 两条产品线在各自的服务商记录上声明关联的 DNS 账号；workflows 只依赖本端口，
 * 不依赖厂商的 access 实现类（面板端读取服务商详情仍走 modules）。
 * 形状厂商无关：返回归一化后的服务商 ID（未关联返回空串），
 * 错误码前缀由编排以字面量传入——静态守卫据此对账（scripts/check-architecture.mjs 的 ARCH028）。
 */

/**
 * 关联来源（声明关联的产品线）。取值既是产品线标识，也是错误码前缀：
 * `${source}_provider_not_found` 与 `${source}_dnspod_provider_missing`。
 */
export type LinkedDnsAccountSource = 'edgeone' | 'saas'

export interface LinkedDnsAccountPort {
  /** 读取关联的 DNS 服务商 ID；未关联返回空串 */
  linkedProviderId(providerId: string, source: LinkedDnsAccountSource, label: string): Promise<string>
  /** 要求已关联，未关联抛 422 `${source}_dnspod_provider_missing` */
  requireLinkedProviderId(providerId: string, source: LinkedDnsAccountSource, label: string): Promise<string>
}
