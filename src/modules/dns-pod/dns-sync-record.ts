export interface DnsSyncRecord {
  type: string
  name: string
  value: string
  purpose: string
  provider_id: string
  [key: string]: unknown
}
