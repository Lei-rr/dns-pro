const zoneStatusLabels: Record<string, string> = {
  enable: '正常',
  enabled: '正常',
  success: '正常',
  pause: '已暂停',
  spam: '违规',
  dnserror: 'NS 异常',
  dns_error: 'NS 异常',
}

const zoneStatusGreen = new Set(['enable', 'enabled', 'success'])
const zoneStatusGold = new Set(['pause'])
const zoneStatusRed = new Set(['dnserror', 'dns_error', 'spam'])

export default {
  recordLines: [
    { label: '默认', value: '默认' },
    { label: '境内', value: '境内' },
    { label: '电信', value: '电信' },
    { label: '联通', value: '联通' },
    { label: '移动', value: '移动' },
    { label: '境外', value: '境外' },
  ],
  zoneStatusColumns: [
    {
      key: 'status',
      title: '托管状态',
      getStatus: (record: Record<string, unknown>) => record.status,
    },
    {
      key: 'dns_status',
      title: 'NS 状态',
      getStatus: (record: Record<string, unknown>) => record.dns_status,
    },
  ],
  showLine: (lines: Array<unknown>) => lines.length > 0,
  zoneStatusLabel(status: unknown) {
    if (status === '') return '正常'
    const k = String(status || '').toLowerCase()
    return zoneStatusLabels[k] || (status as string) || '-'
  },
  zoneStatusColor(status: unknown) {
    if (status === '') return 'green'
    const k = String(status || '').toLowerCase()
    if (zoneStatusGreen.has(k)) return 'green'
    if (zoneStatusGold.has(k)) return 'gold'
    if (zoneStatusRed.has(k)) return 'red'
    return k ? 'blue' : 'default'
  },
}
