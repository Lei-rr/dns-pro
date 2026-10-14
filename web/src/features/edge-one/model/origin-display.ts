import type { EdgeOneAccelerationDomain } from '@/features/edge-one/model/types'

type OriginDisplayInput = Pick<
  EdgeOneAccelerationDomain,
  'origin' | 'origin_type' | 'origin_protocol' | 'http_origin_port' | 'https_origin_port'
>

/** 已含端口的地址：host:port 或 [IPv6]:port——再拼一次会得到 1.2.3.4:80:80 */
const ADDRESS_WITH_PORT = /^(?:\[[^\]]+\]|[^:]+):\d+$/

/**
 * 源站展示文案：源站列需要直接看到回源端口（如 150.40.181.85:80）。
 * 端口按回源协议取：HTTPS 用 https_origin_port，HTTP/FOLLOW/缺省用 http_origin_port；
 * 上游未回传端口时退到协议默认端口（与表单默认值一致：HTTP 80 / HTTPS 443）。
 * 无源站地址时保持旧行为，退回源站类型（如 IP_DOMAIN）。
 */
export function edgeOneOriginDisplay(record: OriginDisplayInput): string {
  const value = record.origin?.value
  if (!value) return record.origin?.type || record.origin_type || '-'
  // 上游已给出端口时原样展示，避免重复拼接
  if (ADDRESS_WITH_PORT.test(value)) return value
  const isHttps = String(record.origin_protocol || '').toUpperCase() === 'HTTPS'
  const port = isHttps ? (record.https_origin_port ?? 443) : (record.http_origin_port ?? 80)
  // IPv6 字面量必须加方括号，否则 240e::1:80 分不清哪一段是端口
  const host = value.startsWith('[') || !value.includes(':') ? value : `[${value}]`
  return `${host}:${port}`
}
