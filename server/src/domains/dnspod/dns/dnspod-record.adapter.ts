import type {
  DnsRecordPort,
  DnsRecordProbe,
  DnsRecordRef,
  DnsRecordValue,
} from '../../../kernel/contracts/dns-record.port.js'
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
  if (value.status !== undefined && value.status !== '') {
    input.status = String(value.status).toUpperCase() === 'DISABLE' ? 'DISABLE' : 'ENABLE'
  }
  if (value.weight !== undefined) input.weight = Number(value.weight)
  return input
}

/** DNSPod 记录 → 端口值（name 已是相对主机记录） */
function toValue(item: DnsPodRecordItem): DnsRecordValue {
  return {
    type: String(item.type ?? '').toUpperCase(),
    name: String(item.name ?? ''),
    value: String(item.value ?? ''),
    ttl: Number(item.ttl),
    line: String(item.line ?? ''),
    lineId: String(item.line_id ?? ''),
    priority: Number(item.mx),
    note: String(item.remark ?? ''),
    status: String(item.status ?? ''),
    weight: Number(item.weight),
  }
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
      // 查询现状走 query：findExact 要求 value 非空，仅适用于写入前的精确匹配
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
