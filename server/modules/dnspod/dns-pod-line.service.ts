import type { ProviderRepository } from '../../core/providers/provider.repository.js'
import { providerCacheTag, recordLineCacheTag, withProviderCache } from '../../core/cache/provider-cache.js'
import { callProvider } from '../../core/providers/provider-call.js'
import { asRecordArray } from '../../core/providers/response-guards.js'
import { providerOptionalString, providerString } from '../../core/providers/provider-values.js'
import { toAsciiFqdn } from '../../shared/values.js'
import { dnsPodClientFor } from './dns-pod.client.js'
import { DNSPOD_PROVIDER_TYPE } from './dns-pod.cache.js'
import { dnspodRecordLineListResponseSchema } from './dns-pod-response.schema.js'
import type { DnsPodZoneService } from './dns-pod-zone.service.js'

interface DnsPodLine {
  name: string
  line_id: string
}

export interface DnsPodLineListResult {
  /** 可单独选择的线路（默认、电信、联通…） */
  items: DnsPodLine[]
  /** 线路分组（境内、境外…），按名称提交 */
  groups: DnsPodLine[]
  request_id?: string
}

/**
 * DNSPod 可用解析线路：随域名套餐等级变化，必须按域名查询。
 * 前端不再硬编码线路，避免选择套餐未包含的线路导致上游报错。
 */
export class DnsPodLineService {
  constructor(
    private readonly providers: ProviderRepository,
    private readonly zones: DnsPodZoneService,
    private readonly httpTimeoutMs?: number
  ) {}

  async lines(providerId: string, zone: string, refresh = false): Promise<DnsPodLineListResult> {
    const domain = zone.toLowerCase().trim()
    const cached = await withProviderCache<DnsPodLineListResult>({
      key: `${DNSPOD_PROVIDER_TYPE}:lines:${providerId}:${domain}`,
      tags: [providerCacheTag(providerId), recordLineCacheTag(DNSPOD_PROVIDER_TYPE, providerId, domain)],
      refresh,
      loader: () => this.fetchLines(providerId, domain),
    })
    return cached.value
  }

  private async fetchLines(providerId: string, domain: string): Promise<DnsPodLineListResult> {
    const client = await dnsPodClientFor(this.providers, providerId, this.httpTimeoutMs)
    const grade = await this.zoneGrade(providerId, domain)
    const response = await callProvider(
      {
        code: 'dnspod_line_list_failed',
        message: 'DNSPod record line list failed',
        providerId,
        details: { zone: domain },
      },
      () => client.call('DescribeRecordLineList', { Domain: domain, DomainGrade: grade || undefined })
    )
    const parsed = dnspodRecordLineListResponseSchema.parse(response)
    return {
      items: asRecordArray(parsed.LineList).map(presentLine).filter(isPresent),
      groups: asRecordArray(parsed.LineGroupList).map(presentLine).filter(isPresent),
      request_id: providerOptionalString(parsed.RequestId),
    }
  }

  /** 线路查询需要域名套餐等级；取不到时由上游自行判断 */
  private async zoneGrade(providerId: string, domain: string): Promise<string> {
    const zones = await this.zones.list(providerId)
    // IDN 域名同时返回 Unicode 名与 punycode：统一取 ASCII 形态，否则与请求域名匹配不上而丢掉套餐等级
    const ascii = toAsciiFqdn(domain)
    return zones.items.find((item) => toAsciiFqdn(item.punycode || item.name) === ascii)?.grade ?? ''
  }
}

function presentLine(line: Record<string, unknown>): DnsPodLine {
  return { name: providerString(line.Name), line_id: providerString(line.LineId) }
}

function isPresent(line: DnsPodLine): boolean {
  return line.name !== '' && line.line_id !== ''
}
