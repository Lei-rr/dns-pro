import { ApiError } from '../../core/http/api-error.js'

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

/**
 * 更新路径专用：只归一化显式提供的字段。
 * ModifyAccelerationDomain 对未提供的字段语义是「保持原有配置」，
 * 因此这里不能像创建路径那样回填默认值，否则只改源站也会重置回源协议与 IPv6 配置。
 */
export function normalizeAccelerationDomainUpdatePayload(
  data: Record<string, unknown>
): Partial<AccelerationDomainPayload> & { domain_name: string } {
  const domainName = String(data.domain_name ?? '')
    .toLowerCase()
    .trim()
  if (domainName === '') throw new ApiError('validation_failed', 'domain_name is required', 422)
  const payload: Partial<AccelerationDomainPayload> & { domain_name: string } = { domain_name: domainName }
  if (data.origin !== undefined) payload.origin = String(data.origin).trim()
  if (data.origin_type !== undefined) payload.origin_type = String(data.origin_type).toUpperCase()
  if (data.host_header !== undefined) {
    payload.host_header = String(data.host_header).toLowerCase().trim()
  }
  if (data.origin_protocol !== undefined) payload.origin_protocol = String(data.origin_protocol).toUpperCase()
  if (data.http_origin_port !== undefined) payload.http_origin_port = Number(data.http_origin_port)
  if (data.https_origin_port !== undefined) payload.https_origin_port = Number(data.https_origin_port)
  if (data.ipv6_status !== undefined) payload.ipv6_status = String(data.ipv6_status).toLowerCase()
  return payload
}

/** 加速域名写入路径：创建没有旧值可清空，更新必须能把 HOST 清回加速域名 */
type AccelerationDomainRequestMode = 'create' | 'update'

/**
 * 构建 Create/ModifyAccelerationDomain 公共参数；未提供的字段不下发，端口仅按回源协议传递。
 *
 * HostHeader 用显式 `!== undefined` 判定：空串是前端「切回加速域名 HOST / 清空自定义」的表达，
 * falsy 判定会把它静默丢掉，而 ModifyAccelerationDomain 对未提供字段的语义是「保持原有配置」——
 * 用户点清空后旧值会原样留在上游。创建路径没有旧值可清空，仍省略空串（避免上游对空串报错）。
 */
export function buildAccelerationDomainRequest(
  zoneId: string,
  data: Partial<AccelerationDomainPayload> & { domain_name: string },
  mode: AccelerationDomainRequestMode = 'create'
): Record<string, unknown> {
  const request: Record<string, unknown> = { ZoneId: zoneId, DomainName: data.domain_name }
  if (data.origin !== undefined || data.origin_type !== undefined || data.host_header !== undefined) {
    const originInfo: Record<string, unknown> = {}
    if (data.origin_type !== undefined) originInfo.OriginType = data.origin_type
    if (data.origin !== undefined) originInfo.Origin = data.origin
    if (data.host_header !== undefined && (data.host_header !== '' || mode === 'update')) {
      originInfo.HostHeader = data.host_header
    }
    request.OriginInfo = originInfo
  }
  if (data.origin_protocol !== undefined) request.OriginProtocol = data.origin_protocol
  if (data.ipv6_status !== undefined) request.IPv6Status = data.ipv6_status
  if (data.origin_protocol !== 'HTTPS' && data.http_origin_port !== undefined) {
    request.HttpOriginPort = data.http_origin_port
  }
  if (data.origin_protocol !== 'HTTP' && data.https_origin_port !== undefined) {
    request.HttpsOriginPort = data.https_origin_port
  }
  return request
}
