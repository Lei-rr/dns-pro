import { ApiError } from '../../kernel/http/api-error.js'
import { errorMessage } from '../../lib/values.js'
import {
  relativeRecordName,
  type DnsRecordPort,
  type DnsRecordRef,
  type DnsRecordValue,
} from '../../kernel/contracts/dns-record.port.js'
import { planSync, type DesiredRecord, type SyncAction, type SyncPlan, type SyncPlanEntry } from './sync-plan.js'

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
 * 策略由产品线声明（DesiredRecord），这里只做归属校验与执行，不做业务判断。
 */
export class DnsWriter {
  constructor(private readonly ports: Record<string, DnsRecordPort>) {}

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
      const probe = {
        name: relativeRecordName(want.fqdn, zone),
        type: String(want.record.type || 'A').toUpperCase(),
      }
      current.push(...(await port.find(providerId, zone, probe)))
    }
    return this.apply(providerType, providerId, zone, planSync({ providerType, providerId, zone, desired, current }))
  }

  /** 冲突清理：删除同名下与目标类型冲突的记录，为写入让路（保留 CNAME/TXT/NS/SOA） */
  async preclean(
    providerType: string,
    providerId: string,
    zone: string,
    target: { fqdn: string; type: string }
  ): Promise<WriteOutcome[]> {
    const port = this.portOf(providerType)
    const wantedType = String(target.type).toUpperCase()
    const rows = await port.find(providerId, zone, { name: relativeRecordName(target.fqdn, zone) })
    const outcomes: WriteOutcome[] = []
    for (const ref of rows) {
      const type = String(ref.value.type ?? '').toUpperCase()
      if (type === '' || type === wantedType) continue
      if (PRECLEAN_KEEP_TYPES.has(type) || PRECLEAN_NEVER_DELETE_TYPES.has(type)) continue
      outcomes.push(await this.removeRef(port, providerId, zone, target.fqdn, ref, 'conflict_cleanup'))
    }
    return outcomes
  }

  /** 执行计划（可由 planSync 产出，也可由调用方构造） */
  async apply(providerType: string, providerId: string, zone: string, plan: SyncPlan): Promise<WriteOutcome[]> {
    const port = this.portOf(providerType)
    const outcomes: WriteOutcome[] = []
    for (const entry of plan.entries) outcomes.push(await this.runEntry(port, providerId, zone, entry))
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
    entry: SyncPlanEntry
  ): Promise<WriteOutcome> {
    const value: DnsRecordValue = { ...entry.record, name: relativeRecordName(entry.fqdn, zone) }
    const base = {
      purpose: entry.purpose,
      action: entry.action,
      fqdn: entry.fqdn,
      value: String(entry.record.value ?? ''),
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
