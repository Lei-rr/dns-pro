export const defaultProviderHook = {
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
  proxyTypes: [] as string[],
  recordLines: [] as Array<{ label: string; value: string }>,
  showLine: (lines: Array<unknown>) => lines.length > 0,
  zoneStatusColumns: [
    {
      key: 'status',
      title: '状态',
      getStatus: (record: Record<string, unknown>) => record.status || record.access_status || record.dns_status,
    },
  ],
  zoneStatusLabel: (status: unknown) => (status as string) || '-',
  zoneStatusColor: (status: unknown) => (status ? 'blue' : 'default'),
}

export function mergeHook(custom: Record<string, unknown> | undefined) {
  if (!custom) return defaultProviderHook
  return {
    ...defaultProviderHook,
    ...custom,
    capabilities: { ...defaultProviderHook.capabilities, ...((custom.capabilities as Record<string, boolean>) || {}) },
  }
}

export type ProviderHook = ReturnType<typeof mergeHook>
