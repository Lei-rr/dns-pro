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
  /**
   * 新建加速域名默认开启「自动同步 DNSPod」：CNAME 落 DNS 是这条流程的主要目的，
   * 让用户为「忘记勾选」补一次修复解析是更差的默认。
   * 未关联 DNSPod 的站点由对话框强制回落 false（开关此时不渲染，不能悄悄下发 auto_sync）。
   */
  autoSync: true,
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
    // 编辑既有域名不得默认勾选自动同步：不能靠「打开对话框」把用户的解析写一遍
    autoSync: false,
  }
}

/**
 * 表单前缀 → 完整加速域名。幂等：用户可能直接粘贴完整域名（或编辑既有域名回读出的带 zone 前缀），
 * 此时不再重复拼接 zone，避免产生 m.guolei.cc.guolei.cc 这类二次拼接域名；
 * 含点但不属于本站点的输入按完整域名原样交出（异 zone 由上游校验拒绝，好过拼成 xxx.example.com.example.com）。
 */
export function edgeOneDomainFullName(prefix: string, zoneName: string): string {
  const zone = String(zoneName || '')
    .trim()
    .replace(/\.$/, '')
  const raw = String(prefix || '')
    .trim()
    .replace(/\.$/, '')
  if (!raw || raw === '@') return zone
  if (!zone) return raw
  const lower = raw.toLowerCase()
  const lowerZone = zone.toLowerCase()
  if (lower === lowerZone || lower.endsWith(`.${lowerZone}`)) return raw
  if (raw.includes('.')) return raw
  return `${raw}.${zone}`
}

/**
 * 「前缀」输入框只接受前缀。用户从地址栏或别处粘贴完整域名时在这里收敛：
 * 属于当前站点的（子）域剥成前缀、站点本身归一为 '@'，落在别的域名上报错——
 * 让整串当 domain_name 提交会创建出站点之外的加速域名，交给上游只会换来一句更难懂的拒绝。
 */
export interface EdgeOnePrefixNormalization {
  /** 收敛后的前缀：'@' 表示站点本身，其余为相对前缀 */
  prefix: string
  /** 输入落在当前站点之外时的错误提示，可收敛时为 null */
  error: string | null
}

export function normalizeEdgeOneDomainPrefix(raw: string, zoneName: string): EdgeOnePrefixNormalization {
  const zone = String(zoneName || '')
    .trim()
    .replace(/\.$/, '')
    .toLowerCase()
  const original = String(raw || '').trim()
  if (!original) return { prefix: '', error: null }

  // 从浏览器地址栏粘贴：剥协议头、路径与端口，只留主机名
  let host = original.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  host = host.split(/[/?#]/, 1)[0] || ''
  host = host.replace(/:\d+$/, '').replace(/\.$/, '')
  if (!host) return { prefix: '', error: null }
  if (host === '@' || host === '*') return { prefix: host, error: null }

  const lower = host.toLowerCase()
  if (zone && (lower === zone || lower.endsWith(`.${zone}`))) {
    const stripped = host.slice(0, host.length - zone.length).replace(/\.$/, '')
    return { prefix: stripped || '@', error: null }
  }
  if (host.includes('.')) {
    return {
      prefix: original,
      error: `只填 ${zone || '站点'} 的子域前缀（如 www）；「${host}」不属于该站点`,
    }
  }
  return { prefix: host, error: null }
}

/** 提交给后端的字段：IP/域名源站总带 host_header（自定义填值、加速域名模式显式空串以清空旧值） */
interface EdgeOneDomainSubmitValues {
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
