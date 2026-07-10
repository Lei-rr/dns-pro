export interface SyncDriver {
  preflight(providerId: string, hostnameFqdn: string, data?: Record<string, unknown>): Promise<Record<string, unknown>>
  sync(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>>
  resyncAfterUpdate(
    providerId: string,
    cfZoneName: string,
    hostnameFqdn: string,
    beforeRecords: Array<Record<string, unknown>>
  ): Promise<Record<string, unknown>>
  cleanup(providerId: string, hostnameFqdn: string, records: Array<Record<string, unknown>>): Promise<Record<string, unknown>>
  cleanupStaleRecords(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>>
  collectRecordsFor(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>>
}
