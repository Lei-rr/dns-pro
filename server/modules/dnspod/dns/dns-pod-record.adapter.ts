import {
  dnsRecordStatusOf,
  type DnsRecordPort,
  type DnsRecordProbe,
  type DnsRecordRef,
  type DnsRecordStatus,
  type DnsRecordValue,
} from '../../../core/contracts/dns-record.port.js'
import { ApiError } from '../../../core/http/api-error.js'
import {
  DNSPOD_DEFAULT_LINE,
  type DnsPodRecordItem,
  type DnsPodRecordService,
  type RecordCreateInput,
} from '../dns-pod-record.service.js'

/** 端口值 → DNSPod 请求字段（zone 即域名，无需转换） */
function toInput(value: DnsRecordValue): RecordCreateInput {
  const input: RecordCreateInput = {
    record_type: String(value.type || 'A').toUpperCase(),
    record_line: String(value.line ?? DNSPOD_DEFAULT_LINE) || DNSPOD_DEFAULT_LINE,
    value: String(value.value ?? ''),
    subdomain: String(value.name || '@') || '@',
  }
  if (value.ttl !== undefined) input.ttl = Number(value.ttl)
  if (value.priority !== undefined) input.mx = Number(value.priority)
  if (value.note !== undefined) input.remark = String(value.note)
  if (value.lineId !== undefined && value.lineId !== '') input.record_line_id = String(value.lineId)
  if (value.status !== undefined) input.status = recordStatusFlag(value.status)
  if (value.weight !== undefined) input.weight = Number(value.weight)
  return input
}

/**
 * 启停状态 → DNSPod 状态标志：联合已闭合，穷尽映射。
 * 未知值只可能来自绕过类型的调用，显式 422 而不是归一成 ENABLE——「要求停用」被写成启用是用户不可见的错误。
 */
function recordStatusFlag(status: DnsRecordStatus): 'ENABLE' | 'DISABLE' {
  switch (status) {
    case 'ENABLE':
      return 'ENABLE'
    case 'DISABLE':
      return 'DISABLE'
    default:
      throw new ApiError('dns_record_status_invalid', `Unsupported DNS record status: ${String(status)}`, 422)
  }
}

/** DNSPod 记录 → 端口值（name 已是相对主机记录） */
function toValue(item: DnsPodRecordItem): DnsRecordValue {
  const value: DnsRecordValue = {
    type: String(item.type ?? '').toUpperCase(),
    name: String(item.name ?? ''),
    value: String(item.value ?? ''),
    ttl: Number(item.ttl),
    line: String(item.line ?? ''),
    lineId: String(item.line_id ?? ''),
    priority: Number(item.mx),
    note: String(item.remark ?? ''),
    weight: Number(item.weight),
  }
  // 上游状态未知（非 ENABLE/DISABLE）时不设置该字段：判等时按「现状未声明」处理，宁可更新也不误判一致
  const status = dnsRecordStatusOf(item.status)
  if (status !== undefined) value.status = status
  return value
}

/** DNSPod 记录端口：zone 即域名 */
export function dnsPodRecordPort(records: DnsPodRecordService): DnsRecordPort {
  return {
    /** 省略 type 时返回该主机名下全部类型（冲突清理需要） */
    async find(providerId: string, zone: string, probe: DnsRecordProbe): Promise<DnsRecordRef[]> {
      const subdomain = String(probe.name || '@').toLowerCase() || '@'
      const recordType = String(probe.type ?? '')
        .trim()
        .toUpperCase()
      const line = String(probe.line ?? DNSPOD_DEFAULT_LINE) || DNSPOD_DEFAULT_LINE
      const lineId = String(probe.lineId ?? '')
      // 匹配依赖上游最新状态：走 query（绕过列表缓存），匹配谓词只在本适配器维护
      const rows = await records.query(providerId, zone, {
        subdomain,
        ...(recordType ? { record_type: recordType } : {}),
      })
      return rows
        .filter((row) => {
          if (String(row.name ?? '').toLowerCase() !== subdomain) return false
          if (recordType && String(row.type ?? '').toUpperCase() !== recordType) return false
          if (lineId) return String(row.line_id ?? '') === lineId
          return String(row.line || DNSPOD_DEFAULT_LINE) === line
        })
        .map((row) => ({ id: String(row.id), value: toValue(row) }))
    },
    async create(providerId: string, zone: string, value: DnsRecordValue): Promise<DnsRecordRef> {
      const created = await records.create(providerId, zone, toInput(value))
      return { id: String(created.id ?? ''), value }
    },
    async update(providerId: string, zone: string, recordId: string, value: DnsRecordValue): Promise<DnsRecordRef> {
      const updated = await records.update(providerId, zone, recordId, toInput(value))
      return { id: String(updated.id ?? recordId), value }
    },
    async remove(providerId: string, zone: string, recordId: string): Promise<void> {
      await records.delete(providerId, zone, recordId)
    },
  }
}
