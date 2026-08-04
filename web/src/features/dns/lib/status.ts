export function dnsZoneStatusLabel(status?: string | null) {
  const key = String(status || '')
    .trim()
    .toLowerCase()
  return (
    {
      enable: '已生效',
      enabled: '已生效',
      active: '已生效',
      online: '已生效',
      disable: '已停用',
      disabled: '已停用',
      offline: '已停用',
      pending: '配置中',
      processing: '处理中',
      forbidden: '已封禁',
      deleted: '已删除',
    }[key] || (key ? '状态未知' : '-')
  )
}
