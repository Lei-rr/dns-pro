import { defaultProviderHook, makeZoneStatusRenderer } from '@/modules/common/dns/hook'
import type { ProviderHook } from '@/types'

const { zoneStatusLabel, zoneStatusColor } = makeZoneStatusRenderer({
  labels: {
    active: '正常',
    pending: '待接入',
    pending_nameserver: '待接入',
    initializing: '初始化中',
    moved: '已迁移',
    deactivated: '已停用',
    read_only: '只读',
  },
  green: ['active'],
  gold: ['pending', 'pending_nameserver', 'initializing'],
  red: ['deactivated'],
  fallbackColor: 'default',
})

const hook: ProviderHook = {
  ...defaultProviderHook,
  showTtl: false,
  lineLabel: '代理',
  proxyLabel: '启用 Cloudflare 代理',
  proxyOnText: '已开启',
  proxyOnColor: 'orange',
  proxyTypes: ['A', 'AAAA', 'CNAME'],
  recordLines: [],
  showLine: () => false,
  zoneStatusLabel,
  zoneStatusColor,
}

export default hook
