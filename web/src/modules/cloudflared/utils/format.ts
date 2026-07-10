export const tunnelStatusLabels: Record<string, string> = {
  healthy: '已连接',
  degraded: '降级',
  down: '已断开',
  inactive: '未连接',
}

export const tunnelStatusColors: Record<string, string> = {
  healthy: 'green',
  degraded: 'orange',
  down: 'red',
  inactive: 'default',
}

export const protocolOptions = [
  { value: 'http', label: 'HTTP' },
  { value: 'https', label: 'HTTPS' },
  { value: 'tcp', label: 'TCP' },
  { value: 'ssh', label: 'SSH' },
  { value: 'rdp', label: 'RDP' },
  { value: 'smb', label: 'SMB' },
]

export function statusLabel(status: string) {
  return tunnelStatusLabels[status] || status || '-'
}

export function statusColor(status: string) {
  return tunnelStatusColors[status] || 'default'
}

export function parseServiceUrl(service: string) {
  const match = String(service || '').match(/^(\w+):\/\/(.+)$/)
  if (!match) return { protocol: 'http', address: '' }
  return { protocol: match[1].toLowerCase(), address: match[2] }
}

export function hostnamePrefix(hostname: string, zoneName: string) {
  if (!hostname || !zoneName) return ''
  if (hostname === zoneName) return '@'
  const suffix = '.' + zoneName
  return hostname.endsWith(suffix) ? hostname.slice(0, -suffix.length) : hostname
}
