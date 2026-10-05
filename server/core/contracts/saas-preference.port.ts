/**
 * 契约端口：SaaS 主机名本地偏好（data/saas/preferences.json）。
 *
 * 删除流程读取「所有权 TXT 已清理」标记、服务商依赖反查读取全量行；两者都不关心存储键模型与收编细节。
 * 形状厂商无关：字段为落盘行的归一化视图（身份索引 + 同步配置 + 清理标记），不是存储原始行的任意扩展字段。
 */

/** 偏好行读模型：主机名身份索引 + 同步配置 + 所有权清理标记 */
interface SaaSPreferenceValue {
  hostname: string
  hostname_id: string
  preferred_domain: string
  sync_target: string
  sync_provider_id: string
  sync_zone: string
  auto_preferred: boolean
  ownership_txt_cleaned: boolean
}

export interface SaaSPreferencePort {
  /** 全部偏好行，键为身份键 `<cloudflareProviderId>:<zone>:<fqdn>`（站点未知行为 `:<fqdn>`） */
  listAll(options?: { fresh?: boolean }): Promise<Record<string, SaaSPreferenceValue>>
  /** 所有权 TXT 是否已清理（按主机名 ID 定位行，旧键行同样命中） */
  ownershipTxtCleaned(cloudflareProviderId: string, hostnameId: string): Promise<boolean>
  /** 标记所有权 TXT 清理状态；行不存在时以「站点未知」身份落行，下次带站点的写入收编；返回标记后的行 */
  markOwnershipTxtCleaned(
    cloudflareProviderId: string,
    hostnameId: string,
    cleaned: boolean,
    hostname?: string
  ): Promise<SaaSPreferenceValue>
}
