/**
 * 契约端口：FQDN → 目标站点 的解析（最长后缀匹配）。
 *
 * 归属取证、派生扫描与写入目标解析都要把主机名落到厂商账号下的站点，但不关心厂商站点模型的细节。
 * 只声明编排实际消费的方法（账号内站点清单属 ZoneListPort，本端口不外露）。
 * 形状厂商无关：站点名归一为小写 punycode；未命中以调用点传入的错误码前缀抛出，
 * 前缀须为字面量——静态守卫据此对账（scripts/check-architecture.mjs 的 ARCH028）。
 */

export interface DnsZoneCatalogPort {
  /** 最长后缀匹配；未命中返回空串 */
  match(providerId: string, fqdn: string): Promise<string>
  /**
   * 要求命中：空 FQDN 抛 422 `${errorCodePrefix}_fqdn_empty`，
   * 账号内没有匹配站点抛 422 `${errorCodePrefix}_dnspod_zone_not_found`。
   */
  resolve(providerId: string, fqdn: string, errorCodePrefix: string): Promise<string>
  /** 显式指定的站点必须存在于账号内，否则抛 422 `${errorCodePrefix}_dnspod_zone_not_found` */
  requireExplicit(providerId: string, zoneName: string, errorCodePrefix: string): Promise<string>
}
