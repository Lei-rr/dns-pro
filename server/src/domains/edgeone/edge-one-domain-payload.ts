import { ApiError } from '../../kernel/http/api-error.js'

export interface AccelerationDomainPayload {
  domain_name: string
  origin_type: string
  origin: string
  host_header: string
  origin_protocol: string
  http_origin_port: number
  https_origin_port: number
  ipv6_status: string
}

/** 规范化加速域名表单 */
export function normalizeAccelerationDomainPayload(data: Record<string, unknown>): AccelerationDomainPayload {
  const domainName = String(data.domain_name ?? '')
    .toLowerCase()
    .trim()
  if (domainName === '') throw new ApiError('validation_failed', 'domain_name is required', 422)
  return {
    domain_name: domainName,
    origin: String(data.origin ?? '').trim(),
    origin_type: String(data.origin_type ?? 'IP_DOMAIN').toUpperCase(),
    host_header: String(data.host_header ?? '')
      .toLowerCase()
      .trim(),
    origin_protocol: String(data.origin_protocol ?? 'FOLLOW').toUpperCase(),
    http_origin_port: Number(data.http_origin_port ?? 80),
    https_origin_port: Number(data.https_origin_port ?? 443),
    ipv6_status: String(data.ipv6_status ?? 'follow').toLowerCase(),
  }
}

/** 构建 Create/ModifyAccelerationDomain 公共参数；端口仅按回源协议传递 */
export function buildAccelerationDomainRequest(
  zoneId: string,
  data: AccelerationDomainPayload
): Record<string, unknown> {
  const originInfo: Record<string, unknown> = { OriginType: data.origin_type, Origin: data.origin }
  if (data.host_header) originInfo.HostHeader = data.host_header
  const request: Record<string, unknown> = {
    ZoneId: zoneId,
    DomainName: data.domain_name,
    OriginInfo: originInfo,
    OriginProtocol: data.origin_protocol,
    IPv6Status: data.ipv6_status,
  }
  if (data.origin_protocol !== 'HTTPS') request.HttpOriginPort = data.http_origin_port
  if (data.origin_protocol !== 'HTTP') request.HttpsOriginPort = data.https_origin_port
  return request
}
