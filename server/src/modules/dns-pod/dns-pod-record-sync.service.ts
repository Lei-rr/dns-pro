import type { ProviderRepository } from '../providers/provider.repository.js'
import type { EdgeOneProvider, ProviderType, SaaSProvider } from '../providers/provider.types.js'
import { ApiError } from '../../shared/http/api-error.js'
import { errorMessage, normalizeFqdn } from '../../shared/lib/values.js'
import type { DnsPodZoneService } from './dns-pod-zone.service.js'
import {
  DNSPOD_DEFAULT_LINE,
  type DnsPodRecordItem,
  type DnsPodRecordService,
  type RecordCreateInput,
} from './dns-pod-record.service.js'

/** 在候选域名中做最长后缀匹配（FQDN 归属判定） */
function longestMatchingZone(fqdn: string, zoneNames: string[]): string {
  const normalized = normalizeFqdn(fqdn)
  if (normalized === '') return ''
  let best = ''
  for (const raw of zoneNames) {
    const name = raw.toLowerCase()
    if (name === '' || (normalized !== name && !normalized.endsWith(`.${name}`))) continue
    if (name.length > best.length) best = name
  }
  return best
}

/** 跨服务商同步记录（DNSPod / Cloudflare DNS 通用） */
export interface DnsSyncRecord {
  type: string
  name: string
  value: string
  purpose: string
  provider_id: string
  [key: string]: unknown
}

/** 删除/清理单条记录的结果 */
interface RecordDeleteResult {
  type: string
  name: string
  value?: string
  record_id: string
  status: 'deleted' | 'not_found' | 'failed'
  error?: string
}

export interface DnsPodSyncRecord extends DnsSyncRecord {
  line?: string
  remark?: string
  ttl?: number
  dnspod_zone?: string
}

// 预清理时保留的类型：CNAME 由同步覆盖，TXT 与 CNAME 不冲突
const PRECLEAN_KEEP_TYPES = new Set(['CNAME', 'TXT'])
// 系统记录绝不能删：NS/SOA 承载解析本身，默认 NS 由 DNSPod 托管
const PRECLEAN_NEVER_DELETE_TYPES = new Set(['NS', 'SOA'])
const DEFAULT_TTL = 600

const stripDot = (value: unknown) => String(value ?? '').replace(/\.$/, '')

/** 跨模块 DNS 写回：EdgeOne / SaaS 把记录同步到关联的 DNSPod */
export class DnsPodRecordSyncService {
  constructor(
    private readonly providers: ProviderRepository,
    private readonly zones: DnsPodZoneService,
    private readonly records: DnsPodRecordService
  ) {}

  /** 读取 EdgeOne/SaaS 关联的 DNSPod 服务商 ID；未关联返回空串 */
  async lookupDnsPodProviderId(providerId: string, providerType: 'edgeone' | 'saas', label: string): Promise<string> {
    const provider = await this.providers.requireType(
      providerId,
      providerType as ProviderType,
      `${label} provider not found`,
      `${providerType}_provider_not_found`
    )
    if (provider.type === 'edgeone') return (provider as EdgeOneProvider).dnspod_provider.trim()
    if (provider.type === 'saas') return ((provider as SaaSProvider).dnspod_provider ?? '').trim()
    return ''
  }

  async requireDnsPodProviderId(providerId: string, providerType: 'edgeone' | 'saas', label: string): Promise<string> {
    const id = await this.lookupDnsPodProviderId(providerId, providerType, label)
    if (id === '') {
      throw new ApiError(
        `${providerType}_dnspod_provider_missing`,
        `${label} provider is not linked to a DNSPod provider`,
        422
      )
    }
    return id
  }

  /** 账号内全部 DNSPod 域名（小写） */
  async zoneNames(dnspodProviderId: string): Promise<string[]> {
    const zones = await this.zones.list(dnspodProviderId)
    return zones.items.map((zone) => zone.name.toLowerCase()).filter(Boolean)
  }

  /** 按最长后缀匹配 FQDN 所属的 DNSPod 域名；未命中返回空串 */
  async matchZone(dnspodProviderId: string, fqdn: string): Promise<string> {
    return longestMatchingZone(fqdn, await this.zoneNames(dnspodProviderId))
  }

  /** 按最长后缀匹配 FQDN 所属的 DNSPod 域名 */
  async resolveDnsPodZone(dnspodProviderId: string, fqdn: string, errorCodePrefix: string): Promise<string> {
    const normalized = normalizeFqdn(fqdn)
    if (normalized === '') throw new ApiError(`${errorCodePrefix}_fqdn_empty`, 'Empty FQDN', 422)

    const best = longestMatchingZone(normalized, await this.zoneNames(dnspodProviderId))
    if (best === '') {
      throw new ApiError(`${errorCodePrefix}_dnspod_zone_not_found`, `No matching DNSPod zone for ${fqdn}`, 422)
    }
    return best
  }

  async requireExplicitDnsPodZone(
    dnspodProviderId: string,
    zoneName: string,
    errorCodePrefix: string
  ): Promise<string> {
    const normalized = normalizeFqdn(zoneName)
    if (normalized !== '' && (await this.zoneNames(dnspodProviderId)).includes(normalized)) return normalized
    throw new ApiError(
      `${errorCodePrefix}_dnspod_zone_not_found`,
      normalized === '' ? 'DNSPod zone is required' : `DNSPod zone ${zoneName} not found`,
      422
    )
  }

  /** 删除与 CNAME 冲突的同名记录（A/AAAA 等），为写入 CNAME 让路 */
  async precleanConflicts(dnspodProviderId: string, dnspodZone: string, fqdn: string): Promise<RecordDeleteResult[]> {
    const subdomain = this.subdomainFromFqdn(fqdn, dnspodZone)
    // 需要该主机名下的全部类型，才能找出与 CNAME 冲突的记录
    const records = await this.records.query(dnspodProviderId, dnspodZone, { subdomain })
    const conflicts = records.filter(
      (item) =>
        item.name === subdomain &&
        item.type !== '' &&
        !item.default_ns &&
        !PRECLEAN_KEEP_TYPES.has(item.type) &&
        !PRECLEAN_NEVER_DELETE_TYPES.has(item.type.toUpperCase())
    )
    return this.deleteEach(dnspodProviderId, dnspodZone, fqdn, conflicts)
  }

  /** 按 名称+类型+线路 删除全部匹配记录 */
  async deleteRecordsByNameType(
    dnspodProviderId: string,
    dnspodZone: string,
    fqdn: string,
    type: string,
    line = DNSPOD_DEFAULT_LINE,
    /** 仅删除该备注的记录；提供后不会误删人工记录 */
    remark?: string
  ): Promise<RecordDeleteResult[]> {
    const subdomain = this.subdomainFromFqdn(fqdn, dnspodZone)
    const matches = (await this.findMatching(dnspodProviderId, dnspodZone, subdomain, type, line)).filter(
      (record) => remark === undefined || record.remark === remark
    )
    return this.deleteEach(dnspodProviderId, dnspodZone, fqdn, matches)
  }

  /** 幂等写入：不存在则创建，值/备注/TTL 不同则更新 */
  async sync(providerId: string, zone: string, record: DnsSyncRecord): Promise<Record<string, unknown>> {
    const base = { type: record.type, name: record.name, value: record.value }
    try {
      const subdomain = this.subdomainFromFqdn(record.name, zone)
      const line = String(record.line ?? DNSPOD_DEFAULT_LINE)
      const payload = buildSyncPayload(record, subdomain, line)
      const matches = await this.findMatching(providerId, zone, subdomain, record.type, line)

      // CNAME 等值可能带/不带末尾点，比较前统一
      const expectedValue = stripDot(record.value)
      const sameValue = matches.find((match) => stripDot(match.value) === expectedValue)
      if (sameValue && sameValue.remark === (payload.remark ?? '') && sameValue.ttl === payload.ttl) {
        return { ...base, status: 'unchanged', record_id: String(sameValue.id) }
      }
      const target = sameValue ?? matches.find((match) => match.id > 0)
      if (target) {
        await this.records.update(providerId, zone, String(target.id), payload)
        return { ...base, status: 'updated', record_id: String(target.id) }
      }
      const created = await this.records.create(providerId, zone, payload)
      return { ...base, status: 'created', record_id: String(created.id) }
    } catch (error) {
      return { ...base, status: 'failed', record_id: '', error: errorMessage(error) }
    }
  }

  /**
   * 删除一条同步记录。
   * 值与备注都为空时不做任何删除：无法确认归属，避免误删同名的人工记录。
   */
  async delete(providerId: string, zone: string, record: DnsSyncRecord): Promise<Record<string, unknown>> {
    const subdomain = this.subdomainFromFqdn(record.name, zone)
    const matches = await this.findMatching(
      providerId,
      zone,
      subdomain,
      record.type,
      String(record.line ?? DNSPOD_DEFAULT_LINE)
    )
    const expectedValue = stripDot(record.value)
    const expectedRemark = String(record.remark ?? '').trim()
    const base = { type: record.type, name: record.name }

    if (expectedValue === '' && expectedRemark === '') {
      return { ...base, status: 'skipped', reason: 'unidentified_record', record_id: '' }
    }
    const match = matches.find(
      (candidate) =>
        (expectedValue === '' || stripDot(candidate.value) === expectedValue) &&
        (expectedRemark === '' || candidate.remark === expectedRemark)
    )
    if (!match) return { ...base, status: 'not_found', record_id: '' }
    const [result] = await this.deleteEach(providerId, zone, record.name, [match])
    return { ...base, ...result }
  }

  /** FQDN → 主机记录（@ 表示根域） */
  subdomainFromFqdn(fqdn: string, zoneName: string): string {
    const normalized = normalizeFqdn(fqdn)
    const zone = normalizeFqdn(zoneName)
    if (normalized === zone) return '@'
    const suffix = `.${zone}`
    return normalized.endsWith(suffix) ? normalized.slice(0, -suffix.length) : normalized
  }

  // 过滤下推到 DNSPod，避免每次同步都全量拉取整个域名
  private async findMatching(providerId: string, zone: string, subdomain: string, type: string, line: string) {
    // 记录类型统一大写：上游对大小写敏感，本地比较也要一致
    const recordType = type.trim().toUpperCase()
    const items = await this.records.query(providerId, zone, { subdomain, record_type: recordType })
    return items.filter(
      (record) =>
        record.type.toUpperCase() === recordType &&
        record.name === subdomain &&
        (record.line || DNSPOD_DEFAULT_LINE) === line
    )
  }

  private async deleteEach(
    providerId: string,
    zone: string,
    fqdn: string,
    records: DnsPodRecordItem[]
  ): Promise<RecordDeleteResult[]> {
    const results: RecordDeleteResult[] = []
    for (const item of records) {
      const entry = { type: item.type, name: fqdn, value: item.value, record_id: String(item.id || '') }
      if (!item.id) {
        results.push({ ...entry, status: 'not_found' })
        continue
      }
      try {
        await this.records.delete(providerId, zone, entry.record_id)
        results.push({ ...entry, status: 'deleted' })
      } catch (error) {
        results.push({ ...entry, status: 'failed', error: errorMessage(error) })
      }
    }
    return results
  }
}

function buildSyncPayload(record: DnsSyncRecord, subdomain: string, line: string): RecordCreateInput {
  const ttl = Number(record.ttl ?? DEFAULT_TTL)
  return {
    record_type: record.type,
    record_line: line,
    value: record.value,
    subdomain,
    ttl: Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_TTL,
    remark: String(record.remark ?? ''),
  }
}
