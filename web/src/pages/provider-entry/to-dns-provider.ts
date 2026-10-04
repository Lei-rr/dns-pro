import type { DnsProviderRef } from '@/features/dns'
import type { ProviderPageProps } from './provider-page-props'

/**
 * DNS 页面（域名列表 / 解析记录）共用的 provider 组装。
 * 页面注册表只把 dnspod / cloudflare / saas 路由到这两个页面，因此这是唯一需要向
 * DnsProviderRef 收窄的一处；断言集中在此，避免两个页面各写一份。
 */
export function toDnsProviderRef(props: ProviderPageProps): DnsProviderRef {
  return {
    id: props.providerId,
    type: props.providerType as DnsProviderRef['type'],
    name: props.providerName,
  }
}
