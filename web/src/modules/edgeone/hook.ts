import { defaultProviderHook } from '@/modules/common/dns/hook'
import type { ProviderHook } from '@/types'

const hook: ProviderHook = {
  ...defaultProviderHook,
}

export default hook
