import type {
  DnsRecordPort,
  DnsRecordProbe,
  DnsRecordRef,
  DnsRecordValue,
} from '../../../kernel/contracts/dns-record.port.js'
import type { CloudflareDnsRecordService, CloudflareRecord, RecordPayload } from '../cloudflare-dns-record.service.js'
import type { CloudflareZoneService } from '../cloudflare-zone.service.js'

/** 相对主机记录 → FQDN（'@' 或空为站点名本身；已是站点后缀时原样保留） */
function toFqdn(nameRaw: string, zone: string): string {
  if (nameRaw === '' || nameRaw === '@') return zone
  const lower = nameRaw.toLowerCase()
  const zoneLower = zone.toLowerCase()
  return lower.endsWith('.' + zoneLower) ? nameRaw : `${nameRaw}.${zone}`
}

/** FQDN → 相对主机记录（站点名本身记作 '@'） */
function toRelative(fqdn: string, zone: string): string {
  const host = fqdn.trim().toLowerCase().replace(/\.+$/, '')
  const base = zone.trim().toLowerCase().replace(/\.+$/, '')
  if (host === base) return '@'
  return host.endsWith(`.${base}`) ? host.slice(0, -(base.length + 1)) : host
}

function toPayload(value: DnsRecordValue, zone: string): RecordPayload {
  const payload: RecordPayload = {
    type: String(value.type || 'A').toUpperCase(),
    name: toFqdn(value.name, zone),
    content: String(value.value ?? ''),
    ttl: Number(value.ttl ?? 1) || 1,
  }
  if (value.priority !== undefined) payload.priority = Number(value.priority)
  if (value.note !== undefined) payload.comment = String(value.note)
  if (value.proxied !== undefined) payload.proxied = Boolean(value.proxied)
  return payload
}

function toValue(record: CloudflareRecord, zone: string): DnsRecordValue {
  const value: DnsRecordValue = {
    type: String(record.type ?? '').toUpperCase(),
    name: toRelative(String(record.name ?? ''), zone),
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
      const fqdn = toFqdn(probe.name, zone)
      const recordType = String(probe.type ?? '')
        .trim()
        .toUpperCase()
      const rows = recordType
        ? await records.findExact(providerId, zoneId, fqdn, recordType)
        : (await records.listAll(providerId, zoneId)).items.filter(
            (row) => String(row.name ?? '').toLowerCase() === fqdn.toLowerCase()
          )
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
