/**
 * 契约端口：站点目录（厂商账号下的站点清单）。
 *
 * 归属取证与派生扫描都要遍历站点，但不关心厂商的站点模型细节。
 * 形状厂商无关：id 为厂商侧站点标识，name 为站点名；读模型只在本文件的端口签名内命名（暂不导出），
 * 实现按结构兼容返回超集。
 */

/** 站点读模型：编排只需要"有哪几个站点" */
interface ZoneSummary {
  id: string
  name: string
}

export interface ZoneListPort {
  /** 账号下的站点清单（refresh 强制回源） */
  zones(providerId: string, refresh?: boolean): Promise<{ items: ZoneSummary[] }>
}
