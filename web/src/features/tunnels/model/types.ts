/** 上游隧道连接器实例：字段与后端 presentTunnel 的 connections 投影一致 */
interface TunnelConnection {
  id?: string
  client_id?: string
  client_version?: string
  colo_name?: string
  origin_ip?: string
  opened_at?: string
  is_pending_reconnect?: boolean
}

/** 隧道详情/列表项：id、name、status、connections 由后端 presentTunnel 保证存在 */
export interface Tunnel {
  id: string
  name: string
  status: string
  connections: TunnelConnection[]
  config_src?: string
  remote_config?: boolean
  conns_active_at?: string
  conns_inactive_at?: string
  created_at?: string
}

/** Ingress 路由：hostname/service/path 为后端契约必填（path 可为空串，表示根路径） */
export interface TunnelRoute {
  hostname: string
  service: string
  path: string
}
