export function tunnelStatusLabel(status?: string) {
  return (
    {
      healthy: '已连接',
      degraded: '降级',
      down: '已断开',
      inactive: '未连接',
    }[String(status || '').toLowerCase()] || (String(status || '').trim() ? '状态未知' : '-')
  )
}
