/**
 * 期望记录的现状取证：按记录身份归并端口查询。
 *
 * DNSPod 的记录查询刻意不吃缓存，同一组内多条期望记录（如 origin_cname 与 preferred_cname）
 * 逐条查询会重复全量分页拉取；这里先归并出唯一查询条件，再并发取证。
 */
import type { DnsRecordPort, DnsRecordProbe, DnsRecordRef } from '../../core/contracts/dns-record.port.js'
import { recordProbe, type DesiredRecord } from './sync-plan.js'

export async function findCurrentRecords(
  port: DnsRecordPort,
  providerId: string,
  zone: string,
  desired: readonly DesiredRecord[]
): Promise<DnsRecordRef[]> {
  const probes = new Map<string, DnsRecordProbe>()
  for (const want of desired) {
    const probe = recordProbe(want.fqdn, zone, want.record)
    const key = [probe.name, probe.type, probe.line ?? '', probe.lineId ?? ''].join('|')
    if (!probes.has(key)) probes.set(key, probe)
  }
  const batches = await Promise.all([...probes.values()].map((probe) => port.find(providerId, zone, probe)))
  return batches.flat()
}
