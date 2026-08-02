import { ApiError } from '../../shared/http/api-error.js'

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

export function normalizeAccelerationDomainPayload(
  data: Record<string, unknown>
): AccelerationDomainPayload & { domain_name: string } {
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

export function buildEdgeOneOriginInfo(data: AccelerationDomainPayload): Record<string, unknown> {
  const origin: Record<string, unknown> = { OriginType: data.origin_type, Origin: data.origin }
  if (data.host_header) origin.HostHeader = data.host_header
  return origin
}
