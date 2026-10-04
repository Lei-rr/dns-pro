/**
 * 服务商路由页的统一注入 props。
 * ProviderEntryPage 只做「provider.type → 页面组件」映射，业务组装下沉到各域页面。
 */
export type ProviderPageProps = {
  providerId: string
  providerName: string
  providerType: string
  /** 第二段路由参数：DNS 的 zone、SaaS 的 zoneName、EdgeOne 的 zoneId、Tunnel 的 tunnelId */
  zoneId: string
}
