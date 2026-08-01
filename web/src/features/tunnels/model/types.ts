export interface TunnelConnection {
  id?: string
  client_id?: string
  client_version?: string
  colo_name?: string
  origin_ip?: string
  opened_at?: string
  is_pending_reconnect?: boolean
  [key: string]: unknown
}

export interface Tunnel {
  id?: string
  name?: string
  status?: string
  connections?: TunnelConnection[]
  created_at?: string
  conns_active_at?: string
  [key: string]: unknown
}

export interface TunnelRoute {
  hostname?: string
  service?: string
  path?: string
  [key: string]: unknown
}
