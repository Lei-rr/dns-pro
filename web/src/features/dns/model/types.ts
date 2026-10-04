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

/** DNSPod 可选解析线路（随域名套餐变化） */
export interface DnsLine {
  name: string
  line_id: string
}

/** 线路下拉项：value 为线路名，lineId 存在时提交给上游更精确 */
export interface DnsLineOption {
  label: string
  value: string
  lineId?: string
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
