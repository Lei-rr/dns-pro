import type { EdgeOneAccelerationDomain } from '@/features/edge-one/model/types'

interface EdgeOneDomainFormValues {
  prefix: string
  origin_type: string
  origin: string
  origin_protocol: string
  http_origin_port: number
  https_origin_port: number
  host_header: string
  host_header_mode: 'accelerate' | 'custom'
  ipv6_status: string
  autoSync: boolean
}

const defaults: EdgeOneDomainFormValues = {
  prefix: '',
  origin_type: 'IP_DOMAIN',
  origin: '',
  origin_protocol: 'HTTP',
  http_origin_port: 80,
  https_origin_port: 443,
  host_header: '',
  host_header_mode: 'accelerate',
  ipv6_status: 'follow',
  autoSync: false,
}

export function edgeOneDomainFormValues(
  domain: EdgeOneAccelerationDomain | null | undefined,
  zoneName: string
): EdgeOneDomainFormValues {
  if (!domain) return { ...defaults }

  const name = String(domain.name || domain.domain_name || '')
    .replace(/\.$/, '')
    .toLowerCase()
  const zone = String(zoneName || '')
    .replace(/\.$/, '')
    .toLowerCase()
  const prefix = name === zone ? '@' : name.endsWith(`.${zone}`) ? name.slice(0, -(zone.length + 1)) : name
  const hostHeader = String(domain.origin?.host_header || '')
  /**
   * 上游把「清空自定义 HOST」表达为回读加速域名自身（真机实测：下发空串后回读值等于域名）。
   * 因此等于域名自身的 HOST 属于加速域名模式；按「非空即自定义」判定会让用户清空后
   * 重新打开对话框时看到一个自己从未填过的自定义 HOST。
   */
  const hostHeaderIsDomainItself = hostHeader.replace(/\.$/, '').toLowerCase() === name

  return {
    prefix,
    origin_type: String(domain.origin?.type || domain.origin_type || defaults.origin_type),
    origin: String(domain.origin?.value || ''),
    origin_protocol: String(domain.origin_protocol || defaults.origin_protocol),
    http_origin_port: Number(domain.http_origin_port ?? defaults.http_origin_port),
    https_origin_port: Number(domain.https_origin_port ?? defaults.https_origin_port),
    host_header: hostHeader,
    host_header_mode: hostHeader && !hostHeaderIsDomainItself ? 'custom' : 'accelerate',
    ipv6_status: String(domain.ipv6_status || defaults.ipv6_status),
    autoSync: false,
  }
}

/** 提交给后端的字段：IP/域名源站总带 host_header（自定义填值、加速域名模式显式空串以清空旧值） */
export interface EdgeOneDomainSubmitValues {
  origin_type: string
  origin: string
  origin_protocol: string
  http_origin_port: number
  https_origin_port: number
  ipv6_status: string
  host_header?: string
}

/** 表单 → 面板 save 的负载：后端字段 + 面板侧派生字段 */
export interface EdgeOneDomainSubmitPayload extends EdgeOneDomainSubmitValues {
  fullDomain: string
  autoSync: boolean
}

export function edgeOneDomainSubmitValues(values: {
  origin_type: string
  origin: string
  origin_protocol: string
  http_origin_port: number
  https_origin_port: number
  host_header: string
  host_header_mode: string
  ipv6_status: string
}): EdgeOneDomainSubmitValues {
  const payload: EdgeOneDomainSubmitValues = {
    origin_type: values.origin_type,
    origin: values.origin,
    origin_protocol: values.origin_protocol,
    http_origin_port: values.http_origin_port,
    https_origin_port: values.https_origin_port,
    ipv6_status: values.ipv6_status,
  }
  if (values.origin_type === 'IP_DOMAIN' && values.host_header_mode === 'custom' && values.host_header.trim()) {
    payload.host_header = values.host_header.trim()
  } else if (values.origin_type === 'IP_DOMAIN') {
    // 显式空串表达「切回加速域名 HOST / 清空自定义」：省略字段会被后端视为「保持原有配置」。
    // 需后端把空串按「清空」下发后才会真正生效（见 blocked 说明）
    payload.host_header = ''
  }
  return payload
}
