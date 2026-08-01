import type { DnsSyncRecord } from '../../modules/dns-pod/dns-sync-record.js'

export type SyncRecord = DnsSyncRecord

export interface SyncCollectedRecords {
  hostname_fqdn: string
  records: SyncRecord[]
}

export interface SyncDriver {
  preflight(providerId: string, hostnameFqdn: string, data?: Record<string, unknown>): Promise<Record<string, unknown>>
  sync(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>>
  resyncAfterUpdate(
    providerId: string,
    cfZoneName: string,
    hostnameFqdn: string,
    beforeRecords: SyncRecord[]
  ): Promise<Record<string, unknown>>
  cleanup(providerId: string, hostnameFqdn: string, records: SyncRecord[]): Promise<Record<string, unknown>>
  cleanupStaleRecords(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>>
  collectRecordsFor(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<SyncCollectedRecords>
}
