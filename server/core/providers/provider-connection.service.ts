import { ApiError } from '../http/api-error.js'
import { errorMessage } from '../../shared/values.js'
import type { ProviderRepository } from './provider.repository.js'
import { requiredLinkRule } from './provider-reference.js'
import type { Provider, ProviderType } from './provider.types.js'

export type ProviderConnectionResult = {
  ok: true
  type: string
  message: string
  details?: Record<string, unknown>
}

type ProviderProbes = {
  dnspodZones: {
    list(providerId: string, options: { refresh: boolean }): Promise<{ items: unknown[] }>
  }
  cloudflareZones: {
    page(
      providerId: string,
      page: number,
      perPage: number,
      name: string,
      refresh: boolean
    ): Promise<{ items: unknown[]; totalCount: number | null }>
  }
  edgeoneZones: { zones(providerId: string, refresh: boolean): Promise<{ items: unknown[] }> }
  tunnels: { list(providerId: string, refresh: boolean): Promise<{ items: unknown[] }> }
}

/** Vendor-specific connectivity probes, separate from provider persistence/CRUD. */
export class ProviderConnectionService {
  constructor(
    private readonly providers: ProviderRepository,
    private readonly probes: ProviderProbes
  ) {}

  async test(id: string, visited: ReadonlySet<string> = new Set()): Promise<ProviderConnectionResult> {
    if (visited.has(id)) {
      throw new ApiError('provider_reference_cycle', `Provider reference cycle detected at ${id}`, 422, {
        provider_id: id,
        chain: [...Array.from(visited), id],
      })
    }
    const provider = await this.providers.find(id)
    if (!provider) throw new ApiError('provider_not_found', 'Provider not found', 404)
    const nextVisited = new Set(visited).add(id)
    // 存储脏数据可能带白名单外的 type：先按 string 取原始值，供 default 分支使用
    const providerType: string = provider.type

    try {
      switch (provider.type) {
        case 'dnspod': {
          const zones = await this.probes.dnspodZones.list(provider.id, { refresh: true })
          const total = zones.items.length
          return { ok: true, type: provider.type, message: `DNSPod 连接正常（域名 ${total} 个）`, details: { total } }
        }
        case 'cloudflare': {
          const zones = await this.probes.cloudflareZones.page(provider.id, 1, 1, '', true)
          const total = zones.totalCount ?? zones.items.length
          return {
            ok: true,
            type: provider.type,
            message: `Cloudflare 连接正常（站点 ${total} 个）`,
            details: { total },
          }
        }
        case 'edgeone': {
          const linked = await this.requireLinked(provider, 'edgeone_dnspod_provider_missing', nextVisited)
          const zones = await this.probes.edgeoneZones.zones(provider.id, true)
          return {
            ok: true,
            type: provider.type,
            message: `EdgeOne 连接正常（站点 ${zones.items.length} 个）`,
            details: { total: zones.items.length, dnspod_provider: linked },
          }
        }
        case 'saas': {
          const linked = await this.requireLinked(provider, 'saas_cloudflare_provider_missing', nextVisited)
          return {
            ok: true,
            type: provider.type,
            message: 'SaaS 关联的 Cloudflare 连接正常',
            details: { cloudflare_provider: linked },
          }
        }
        case 'cloudflared': {
          const linked = await this.requireLinked(provider, 'cloudflared_cloudflare_provider_missing', nextVisited)
          const tunnels = await this.probes.tunnels.list(provider.id, true)
          return {
            ok: true,
            type: provider.type,
            message: `Cloudflare Tunnel 连接正常（隧道 ${tunnels.items.length} 个）`,
            details: { total: tunnels.items.length, cloudflare_provider: linked },
          }
        }
        default: {
          // 白名单外的 type 只可能来自被手工编辑的存储：明确失败，避免 switch 落空后返回 undefined
          throw new ApiError('provider_test_failed', `Unsupported provider type: ${providerType}`, 422, {
            provider_id: id,
            type: providerType,
          })
        }
      }
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError('provider_test_failed', errorMessage(error) || 'Provider test failed', 502, {
        provider_id: id,
        type: provider.type,
      })
    }
  }

  /** 关联字段与目标类型统一取自 PROVIDER_LINK_RULES，避免各处硬编码漂移 */
  private async requireLinked(provider: Provider, missingCode: string, visited: ReadonlySet<string>): Promise<string> {
    const rule = requiredLinkRule(provider.type)
    if (!rule) {
      // 规则表与 provider definition 脱节属于装配错误：宁可测通失败也不静默跳过
      throw new ApiError('provider_test_failed', `No link rule for provider type: ${provider.type}`, 422, {
        provider_id: provider.id,
        type: provider.type,
      })
    }
    const linked = String((provider as Record<string, unknown>)[rule.field] ?? '').trim()
    if (!linked) {
      // 面向用户的文案由 server/core/http/error-messages.ts 的码→中文映射决定：
      // 这里传中文 message 会被 api-response 原样透出，让同一错误码在不同路径给出不同文案
      throw new ApiError(missingCode, `Provider ${provider.type} is missing a linked provider`, 422)
    }
    await this.testLinked(linked, rule.targetType, visited)
    return linked
  }

  private async testLinked(
    id: string,
    expectedType: ProviderType,
    visited: ReadonlySet<string>
  ): Promise<ProviderConnectionResult> {
    const provider = await this.providers.find(id)
    if (!provider) {
      throw new ApiError('provider_reference_not_found', `Linked provider ${id} not found`, 422, {
        provider_id: id,
        expected_type: expectedType,
      })
    }
    if (provider.type !== expectedType) {
      throw new ApiError(
        'provider_reference_type_mismatch',
        `Linked provider ${id} must be ${expectedType}, got ${provider.type}`,
        422,
        { provider_id: id, expected_type: expectedType, actual_type: provider.type }
      )
    }
    return this.test(id, visited)
  }
}
