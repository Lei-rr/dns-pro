export interface Zone {
  id?: string
  name: string
  status?: string
  access_status?: string
  dns_status?: string
  provider?: string
  provider_type?: string
  provider_name?: string
  name_servers?: string[]
  effective_dns?: string[]
  active_status?: string
  area?: string
  type?: string
  [key: string]: unknown
}

export interface DnsRecord {
  id?: string
  name?: string
  type?: string
  value?: string
  content?: string
  ttl?: number | string
  priority?: number | string
  mx?: number | string
  line?: string
  record_line?: string
  record_line_id?: string
  line_id?: string
  remark?: string
  comment?: string
  proxied?: boolean
  subdomain?: string
  record_type?: string
  provider?: string
  provider_type?: string
  fqdn?: string
  status?: string
  [key: string]: unknown
}
