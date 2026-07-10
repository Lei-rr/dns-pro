import type { ProviderHook, ZoneStatusColumn } from '@/types'

export interface ZoneStatusRendererOptions {
  labels?: Record<string, string>
  green?: string[]
  gold?: string[]
  red?: string[]
  emptyLabel?: string
  emptyColor?: string
  fallbackColor?: string
}

export function makeZoneStatusRenderer(options: ZoneStatusRendererOptions = {}) {
  const labels = options.labels ?? {}
  const green = new Set((options.green ?? []).map((s) => s.toLowerCase()))
  const gold = new Set((options.gold ?? []).map((s) => s.toLowerCase()))
  const red = new Set((options.red ?? []).map((s) => s.toLowerCase()))
  const emptyLabel = options.emptyLabel ?? '-'
  const emptyColor = options.emptyColor ?? 'default'
  const fallbackColor = options.fallbackColor ?? 'blue'

  return {
    zoneStatusLabel(status: unknown) {
      if (status === '' || status === undefined || status === null) return emptyLabel
      const key = String(status).toLowerCase()
      return labels[key] || String(status) || emptyLabel
    },
    zoneStatusColor(status: unknown) {
      if (status === '' || status === undefined || status === null) return emptyColor
      const key = String(status).toLowerCase()
      if (green.has(key)) return 'green'
      if (gold.has(key)) return 'gold'
      if (red.has(key)) return 'red'
      return key ? fallbackColor : emptyColor
    },
  }
}

export const defaultProviderHook: ProviderHook = {
  capabilities: {
    createZone: true,
    deleteZone: true,
    importRecords: true,
    exportRecords: true,
  },
  showTtl: true,
  lineLabel: '线路',
  proxyLabel: '启用代理',
  proxyOnText: '代理开启',
  proxyOffText: '仅 DNS',
  proxyOnColor: 'green',
  proxyOffColor: 'default',
  proxyTypes: [],
  recordLines: [],
  showLine: (lines) => lines.length > 0,
  zoneStatusColumns: [
    {
      key: 'status',
      title: '状态',
      getStatus: (record) => record.status || record.access_status || record.dns_status,
    },
  ],
  ...makeZoneStatusRenderer(),
}

export function mergeHook(custom: Partial<ProviderHook> | undefined): ProviderHook {
  if (!custom) return defaultProviderHook
  return {
    ...defaultProviderHook,
    ...custom,
    capabilities: { ...defaultProviderHook.capabilities, ...(custom.capabilities || {}) },
  }
}
