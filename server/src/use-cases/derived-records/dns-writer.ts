import { ApiError } from '../../kernel/http/api-error.js'
import { errorMessage } from '../../lib/values.js'
import {
  relativeRecordName,
  type DnsRecordPort,
  type DnsRecordRef,
  type DnsRecordValue,
} from '../../kernel/contracts/dns-record.port.js'
import {
  normalizeOwnershipHost,
  ownerOf,
  ownershipConflict,
  type DerivedOwner,
  type OwnershipPort,
  type RecordOwnership,
} from '../../kernel/contracts/ownership.port.js'
import {
  planSync,
  recordProbe,
  type DesiredRecord,
  type SyncAction,
  type SyncPlan,
  type SyncPlanEntry,
} from './sync-plan.js'

/** 冲突清理时保留的类型：CNAME 由同步覆盖，TXT 与 CNAME 不冲突 */
const PRECLEAN_KEEP_TYPES = new Set(['CNAME', 'TXT'])
/** 系统记录绝不能删：NS/SOA 承载解析本身 */
const PRECLEAN_NEVER_DELETE_TYPES = new Set(['NS', 'SOA'])

type WriteStatus = 'created' | 'updated' | 'deleted' | 'unchanged' | 'skipped' | 'not_found' | 'failed'

export interface WriteOutcome {
  purpose: string
  action: SyncAction | 'cleanup'
  status: WriteStatus
  fqdn: string
  value: string
  record_id: string
  error?: string
}

/**
 * D3：唯一 DNS 写入口。
 * D4：写入/删除前按派生关系校验归属——同名被其它产品线声明时拒绝；
 * 无派生归属（manual）的主机名只有声明了来源（refId）才允许写入，删除同理，杜绝误删人工记录。
 */
export class DnsWriter {
  constructor(
    private readonly ports: Record<string, DnsRecordPort>,
    private readonly ownership: OwnershipPort
  ) {}

  /** 声明期望记录 → 查现状 → 算计划 → 执行；单条失败不中断其余条目 */
  async sync(
    providerType: string,
    providerId: string,
    zone: string,
    desired: DesiredRecord[]
  ): Promise<WriteOutcome[]> {
    const port = this.portOf(providerType)
    const current: DnsRecordRef[] = []
    for (const want of desired) {
      current.push(...(await port.find(providerId, zone, recordProbe(want.fqdn, zone, want.record.type))))
    }
    return this.apply(providerType, providerId, zone, planSync({ providerType, providerId, zone, desired, current }))
  }

  /** 冲突清理：删除同名下与目标类型冲突的记录，为写入让路（保留 CNAME/TXT/NS/SOA） */
  async preclean(
    providerType: string,
    providerId: string,
    zone: string,
    target: { fqdn: string; type: string },
    owner: DerivedOwner
  ): Promise<WriteOutcome[]> {
    const port = this.portOf(providerType)
    const wantedType = String(target.type).toUpperCase()
    const rows = await port.find(providerId, zone, { name: relativeRecordName(target.fqdn, zone) })
    const candidates: DnsRecordRef[] = []
    for (const ref of rows) {
      const type = String(ref.value.type ?? '').toUpperCase()
      if (type === '' || type === wantedType) continue
      if (PRECLEAN_KEEP_TYPES.has(type) || PRECLEAN_NEVER_DELETE_TYPES.has(type)) continue
      candidates.push(ref)
    }
    if (candidates.length === 0) return []
    // 冲突清理不声明来源：只允许清理本产品线名下的主机名，人工记录一律保留
    const claims = await this.ownership.claimsFor({ providerType, providerId, zone })
    const refusal = ownershipRefusal(claims, target.fqdn, owner, '')
    const outcomes: WriteOutcome[] = []
    for (const ref of candidates) {
      if (refusal) {
        outcomes.push({
          purpose: 'conflict_cleanup',
          action: 'cleanup',
          status: 'skipped',
          fqdn: target.fqdn,
          value: String(ref.value.value ?? ''),
          record_id: ref.id,
          error: refusal,
        })
        continue
      }
      outcomes.push(await this.removeRef(port, providerId, zone, target.fqdn, ref, 'conflict_cleanup'))
    }
    return outcomes
  }

  /** 执行计划（可由 planSync 产出，也可由调用方构造） */
  async apply(providerType: string, providerId: string, zone: string, plan: SyncPlan): Promise<WriteOutcome[]> {
    const port = this.portOf(providerType)
    const needsOwnership = plan.entries.some((entry) => entry.action !== 'unchanged')
    const claims = needsOwnership ? await this.ownership.claimsFor({ providerType, providerId, zone }) : []
    const outcomes: WriteOutcome[] = []
    for (const entry of plan.entries) outcomes.push(await this.runEntry(port, providerId, zone, entry, claims))
    return outcomes
  }

  private portOf(providerType: string): DnsRecordPort {
    const port = this.ports[providerType]
    if (!port) throw new ApiError('dns_provider_unsupported', `Unsupported DNS provider: ${providerType}`, 422)
    return port
  }

  private async removeRef(
    port: DnsRecordPort,
    providerId: string,
    zone: string,
    fqdn: string,
    ref: DnsRecordRef,
    purpose: string
  ): Promise<WriteOutcome> {
    const base = { purpose, action: 'cleanup' as const, fqdn, value: String(ref.value.value ?? '') }
    if (ref.id === '') return { ...base, status: 'not_found', record_id: '' }
    try {
      await port.remove(providerId, zone, ref.id)
      return { ...base, status: 'deleted', record_id: ref.id }
    } catch (error) {
      return { ...base, status: 'failed', record_id: '', error: errorMessage(error) }
    }
  }

  private async runEntry(
    port: DnsRecordPort,
    providerId: string,
    zone: string,
    entry: SyncPlanEntry,
    claims: readonly RecordOwnership[]
  ): Promise<WriteOutcome> {
    const value: DnsRecordValue = { ...entry.record, name: relativeRecordName(entry.fqdn, zone) }
    const base = {
      purpose: entry.purpose,
      action: entry.action,
      fqdn: entry.fqdn,
      value: String(entry.record.value ?? ''),
    }
    if (entry.action !== 'unchanged') {
      const refusal = ownershipRefusal(claims, entry.fqdn, entry.owner, entry.refId)
      if (refusal) {
        return { ...base, status: 'skipped', record_id: String(entry.existing?.id ?? ''), error: refusal }
      }
    }
    try {
      if (entry.action === 'unchanged') {
        return { ...base, status: 'unchanged', record_id: String(entry.existing?.id ?? '') }
      }
      if (entry.action === 'delete') {
        return this.removeRef(port, providerId, zone, entry.fqdn, entry.existing ?? { id: '', value }, entry.purpose)
      }
      if (entry.action === 'update' && entry.existing) {
        const updated = await port.update(providerId, zone, entry.existing.id, value)
        return { ...base, status: 'updated', record_id: updated.id }
      }
      const created = await port.create(providerId, zone, value)
      return { ...base, status: 'created', record_id: created.id }
    } catch (error) {
      return { ...base, status: 'failed', record_id: '', error: errorMessage(error) }
    }
  }
}

/** D4 归属门禁：返回拒绝原因；空串放行 */
function ownershipRefusal(
  claims: readonly RecordOwnership[],
  fqdn: string,
  declared: DerivedOwner,
  refId: string
): string {
  const conflict = ownershipConflict(claims, fqdn, declared)
  if (conflict) {
    const source = conflict.refId || '未知来源'
    return `owner_mismatch: ${normalizeOwnershipHost(fqdn)} 由 ${conflict.owner}（${source}）管理，拒绝自动写入`
  }
  if (ownerOf(claims, fqdn).owner === 'manual' && refId.trim() === '') {
    return `unowned: ${normalizeOwnershipHost(fqdn)} 无派生归属且未声明来源，拒绝自动写入`
  }
  return ''
}
