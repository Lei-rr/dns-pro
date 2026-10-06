import type { RecordOwner } from '@server/core/contracts/ownership.port.js'

// D4 归属词汇与后端端口层同源（type-only，构建期擦除）：手工镜像的联合漂移只会在运行期暴露
export type { RecordOwner }

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
  zone_name?: string
  status?: string
  /** DNSPod 权重：编辑与批量写回时必须原样回传，否则上游重置 */
  weight?: number | string
  /** 归属：派生来源（saas/tunnel/edgeone）或人工记录（manual，不会被自动删除） */
  owner?: RecordOwner
}
