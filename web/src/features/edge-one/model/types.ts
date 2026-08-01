export interface EdgeOneOrigin {
  type?: string
  value?: string
  host_header?: string
  [key: string]: unknown
}

export interface EdgeOneCertificateItem {
  cert_id?: string
  status?: string
  type?: string
  expire_time?: string
  [key: string]: unknown
}

export interface EdgeOneCertificate {
  mode?: string
  items?: EdgeOneCertificateItem[]
  list?: EdgeOneCertificateItem[]
  [key: string]: unknown
}

export interface EdgeOneAccelerationDomain {
  name?: string
  domain_name?: string
  status?: string
  cname?: string
  origin?: EdgeOneOrigin
  origin_protocol?: string
  origin_type?: string
  http_origin_port?: number
  https_origin_port?: number
  ipv6_status?: string
  certificate?: EdgeOneCertificate
  [key: string]: unknown
}

export interface EdgeOneZone {
  id?: string
  name?: string
  area?: string
  type?: string
  status?: string
  active_status?: string
  [key: string]: unknown
}
