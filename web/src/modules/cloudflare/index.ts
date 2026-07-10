import { createDnsModule } from '@/modules/common/dns'
import hook from './hook'
import type { Provider } from '@/types'

export default createDnsModule({
  name: 'cloudflare',
  providerType: 'cloudflare',
  hook,
  description: (provider: Provider) => `管理 ${provider.name} 域名解析`,
})
