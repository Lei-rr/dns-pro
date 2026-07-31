import type { EdgeOneAccelerationDomain } from '@/shared/types'

export interface EdgeOneDomainFormValues {
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
  zoneName: string,
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

  return {
    prefix,
    origin_type: String(domain.origin?.type || domain.origin_type || defaults.origin_type),
    origin: String(domain.origin?.value || ''),
    origin_protocol: String(domain.origin_protocol || defaults.origin_protocol),
    http_origin_port: Number(domain.http_origin_port ?? defaults.http_origin_port),
    https_origin_port: Number(domain.https_origin_port ?? defaults.https_origin_port),
    host_header: hostHeader,
    host_header_mode: hostHeader ? 'custom' : 'accelerate',
    ipv6_status: String(domain.ipv6_status || defaults.ipv6_status),
    autoSync: false,
  }
}

export function edgeOneDomainSubmitValues(
  values: {
    origin_type: string
    origin: string
    origin_protocol: string
    http_origin_port: number
    https_origin_port: number
    host_header: string
    host_header_mode: string
    ipv6_status: string
  },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    origin_type: values.origin_type,
    origin: values.origin,
    origin_protocol: values.origin_protocol,
    http_origin_port: values.http_origin_port,
    https_origin_port: values.https_origin_port,
    ipv6_status: values.ipv6_status,
  }
  if (
    values.origin_type === 'IP_DOMAIN' &&
    values.host_header_mode === 'custom' &&
    values.host_header.trim()
  ) {
    payload.host_header = values.host_header.trim()
  }
  return payload
}
