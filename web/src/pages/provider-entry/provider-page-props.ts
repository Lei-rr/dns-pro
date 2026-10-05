import type { ProviderType } from '@server/core/providers/provider.types.js'

/**
 * 服务商路由页的统一注入 props。
 * ProviderEntryPage 只做「provider.type → 页面组件」映射，业务组装下沉到各域页面。
 */
export type ProviderPageProps = {
  providerId: string
  providerName: string
  /** 取后端联合类型：新增服务商类型时页面注册表会漏配出编译错误；provider 未加载时为 '' */
  providerType: ProviderType | ''
  /** 第二段路由参数：DNS 的 zone、SaaS 的 zoneName、EdgeOne 的 zoneId、Tunnel 的 tunnelId */
  zoneId: string
}
