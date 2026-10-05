/**
 * 契约端口：Cloudflare 站点标识解析（FQDN → 站点、站点名 → 站点 ID）。
 *
 * 隧道路由 planner 要把 Ingress 主机名落到站点，SaaS 写入要把同步站点名换成站点 ID；
 * 两处共用「账号内站点全集 + 最长后缀匹配」这一底座（D2），workflows 因此不直接依赖站点服务类。
 * 形状厂商无关：站点名归一为小写 punycode，只暴露站点 ID 与站点名；
 * 读模型只在本文件的端口签名内命名（暂不导出），实现按结构兼容返回超集。
 */

/** 站点引用：编排据此拼写入目标（providerId 由调用方持有，不在端口内重复返回） */
interface CloudflareZoneRef {
  zoneId: string
  zoneName: string
}

export interface CloudflareZonePort {
  /** 站点名 → 站点 ID；账号内无此站点抛 404 cloudflare_zone_not_found（清理路径据此判定跳过） */
  idByName(providerId: string, zoneName: string): Promise<string>
  /** 最长后缀匹配 FQDN 所属站点；未命中返回 null */
  resolve(providerId: string, fqdn: string): Promise<CloudflareZoneRef | null>
}
