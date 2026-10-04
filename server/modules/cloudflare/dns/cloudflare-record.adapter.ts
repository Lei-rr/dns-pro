import {
  relativeRecordName,
  type DnsRecordPort,
  type DnsRecordProbe,
  type DnsRecordRef,
  type DnsRecordValue,
} from '../../../core/contracts/dns-record.port.js'
import { toAsciiFqdn } from '../../../shared/values.js'
import {
  toRecordPayload,
  type CloudflareDnsRecordService,
  type CloudflareRecord,
  type RecordPayload,
} from '../cloudflare-dns-record.service.js'
import type { CloudflareZoneService } from '../cloudflare-zone.service.js'

/** 相对主机记录 → FQDN（'@' 或空为站点名本身；已是站点后缀时不再重复拼接） */
function toFqdn(nameRaw: string, zone: string): string {
  if (nameRaw === '' || nameRaw === '@') return zone
  // 导入等路径会送入绝对主机名：与站点同名（'example.com' 配站点 'example.com'）或带尾点时必须
  // 按站点名处理，否则会拼出 example.com.example.com 并查不到、写出重复记录
  const lower = nameRaw.toLowerCase().replace(/\.+$/, '')
  const zoneLower = zone.toLowerCase().replace(/\.+$/, '')
  if (lower === zoneLower) return zoneLower
  return lower.endsWith(`.${zoneLower}`) ? lower : `${lower}.${zoneLower}`
}

function toPayload(value: DnsRecordValue, zone: string): RecordPayload {
  // 可选字段的兜底规则交给 toRecordPayload 单点维护，适配器只做语义映射（note→comment、相对名→FQDN）
  return toRecordPayload({
    type: String(value.type || 'A'),
    name: toFqdn(value.name, zone),
    content: String(value.value ?? ''),
    ttl: value.ttl,
    proxied: value.proxied,
    priority: value.priority,
    comment: value.note,
  })
}

function toValue(record: CloudflareRecord, zone: string): DnsRecordValue {
  const value: DnsRecordValue = {
    type: String(record.type ?? '').toUpperCase(),
    name: relativeRecordName(String(record.name ?? ''), zone),
    value: String(record.content ?? ''),
  }
  if (record.ttl != null) value.ttl = Number(record.ttl)
  if (record.priority != null) value.priority = Number(record.priority)
  const note = String(record.comment ?? '').trim()
  if (note !== '') value.note = note
  if (record.proxied != null) value.proxied = Boolean(record.proxied)
  return value
}

/** Cloudflare 记录端口：路由传站点名，端口内部解析站点 ID（复用站点服务缓存） */
export function cloudflareRecordPort(zones: CloudflareZoneService, records: CloudflareDnsRecordService): DnsRecordPort {
  const zoneIdOf = (providerId: string, zone: string) => zones.idByName(providerId, zone)
  return {
    /** 省略 type 时按名称过滤全量列表（列表有进程内缓存） */
    async find(providerId: string, zone: string, probe: DnsRecordProbe): Promise<DnsRecordRef[]> {
      const zoneId = await zoneIdOf(providerId, zone)
      // Cloudflare 以 punycode 返回域名：IDN 主机名不归一化会恒查不到
      const fqdn = toAsciiFqdn(toFqdn(probe.name, zone))
      const recordType = String(probe.type ?? '')
        .trim()
        .toUpperCase()
      const rows = recordType
        ? await records.findExact(providerId, zoneId, fqdn, recordType)
        : (await records.listAll(providerId, zoneId)).items.filter((row) => toAsciiFqdn(row.name) === fqdn)
      return rows
        .filter((row) => row.id !== null && row.id !== '')
        .map((row) => ({ id: String(row.id), value: toValue(row, zone) }))
    },
    async create(providerId: string, zone: string, value: DnsRecordValue): Promise<DnsRecordRef> {
      const created = await records.create(providerId, await zoneIdOf(providerId, zone), toPayload(value, zone))
      return { id: String(created.id ?? ''), value }
    },
    async update(providerId: string, zone: string, recordId: string, value: DnsRecordValue): Promise<DnsRecordRef> {
      const updated = await records.update(
        providerId,
        await zoneIdOf(providerId, zone),
        recordId,
        toPayload(value, zone)
      )
      return { id: String(updated.id ?? recordId), value }
    },
    async remove(providerId: string, zone: string, recordId: string): Promise<void> {
      await records.delete(providerId, await zoneIdOf(providerId, zone), recordId)
    },
  }
}
