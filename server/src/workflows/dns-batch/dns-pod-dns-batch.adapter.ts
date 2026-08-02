import { DnsPodRecordService } from '../../modules/dns-pod/dns-pod-record.service.js'
import { dnsPodCreateMatches } from './dns-record-equivalence.js'

/** DNS batch adapter: unified workflow command → DNSPod module contract. */
export class DnsPodDnsBatchAdapter {
  constructor(private readonly records: DnsPodRecordService) {}

  async findCreate(providerId: string, zone: string, data: Record<string, unknown>): Promise<unknown | null> {
    const candidates = await this.records.findExact(providerId, zone, data, true)
    return candidates.find((record) => dnsPodCreateMatches(record, data)) ?? null
  }

  create(providerId: string, zone: string, data: Record<string, unknown>): Promise<unknown> {
    return this.records.create(providerId, zone, data)
  }

  delete(providerId: string, zone: string, recordId: string): Promise<unknown> {
    return this.records.delete(providerId, zone, recordId)
  }

  update(providerId: string, zone: string, recordId: string, data: Record<string, unknown>): Promise<unknown> {
    return this.records.update(providerId, zone, recordId, data)
  }
}
