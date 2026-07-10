const zoneStatusLabels: Record<string, string> = {
  active: '正常',
  pending: '待接入',
  pending_nameserver: '待接入',
  initializing: '初始化中',
  moved: '已迁移',
  deactivated: '已停用',
  read_only: '只读',
}

const zoneStatusGreen = new Set(['active'])
const zoneStatusGold = new Set(['pending', 'pending_nameserver', 'initializing'])
const zoneStatusDefault = new Set(['moved', 'deactivated', 'read_only'])

export default {
  showTtl: false,
  lineLabel: '代理',
  proxyLabel: '启用 Cloudflare 代理',
  proxyOnText: '已开启',
  proxyOnColor: 'orange',
  proxyTypes: ['A', 'AAAA', 'CNAME'],
  recordLines: [],
  showLine: () => false,
  zoneStatusLabel(status: unknown) {
    const k = String(status || '').toLowerCase()
    return zoneStatusLabels[k] || (status as string) || '-'
  },
  zoneStatusColor(status: unknown) {
    const k = String(status || '').toLowerCase()
    if (zoneStatusGreen.has(k)) return 'green'
    if (zoneStatusGold.has(k)) return 'gold'
    if (zoneStatusDefault.has(k)) return 'default'
    return k ? 'blue' : 'default'
  },
}
