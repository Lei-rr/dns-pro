/**
 * 契约端口：隧道清单与 Ingress 路由读取（cloudflared 侧）。
 *
 * 归属取证与隧道路由 planner 都要走「cloudflared 服务商 → 隧道 → Ingress 主机名」，
 * 但两端由不同实现者承担（隧道生命周期 / 路由配置），因此拆成两个接口，各自只有一个实现者。
 * 形状厂商无关：只暴露编排消费的字段（隧道 ID 与状态、路由的 hostname/path），不暴露上游 config 的其余字段；
 * 读模型只在本文件的端口签名内命名（暂不导出），实现按结构兼容返回超集。
 */

/** 隧道读模型：编排只需要 ID 与状态 */
interface TunnelValue {
  id: string
  name?: string
  status?: string
}

/** Ingress 路由读模型：编排只消费主机名与路径 */
interface TunnelIngressRoute {
  hostname: string
  service?: string
  path?: string
}

/** Ingress 配置读模型：编排只消费路由表 */
interface TunnelIngressConfig {
  routes: TunnelIngressRoute[]
  catch_all?: string
  version?: number
}

/** 隧道清单：cloudflared 服务商下的隧道 */
export interface TunnelListPort {
  /** 隧道清单（refresh 强制回源；删除的隧道不在列表内） */
  list(providerId: string, refresh?: boolean): Promise<{ items: TunnelValue[] }>
}

/** 隧道 Ingress 路由配置（写路径在 modules 内，编排这里只读） */
export interface TunnelRoutePort {
  /** 隧道 Ingress 配置；读取走 provider 缓存，refresh 强制回源 */
  getConfig(providerId: string, tunnelId: string, refresh?: boolean): Promise<TunnelIngressConfig>
}
