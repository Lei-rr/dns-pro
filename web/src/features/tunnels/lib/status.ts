import { ownValue } from '@/shared/lib/own-value'

const TUNNEL_STATUS_LABELS: Record<string, string> = {
  healthy: '已连接',
  degraded: '降级',
  down: '已断开',
  inactive: '未连接',
}

export function tunnelStatusLabel(status?: string) {
  // 与 dns 侧口径一致：先 trim 再归一，否则 ' down ' 会落到「状态未知」
  const raw = String(status ?? '').trim()
  return ownValue(TUNNEL_STATUS_LABELS, raw.toLowerCase()) ?? (raw ? '状态未知' : '-')
}
