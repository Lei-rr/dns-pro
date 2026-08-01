export function edgeOneStatusLabel(status?: string) {
  const key = String(status || '').toLowerCase()
  return (
    {
      online: '已生效',
      process: '部署中',
      offline: '已停用',
      forbidden: '已封禁',
      init: '未生效',
      active: '已生效',
      pending: '配置中',
    }[key] ||
    status ||
    '-'
  )
}

/** EdgeOne zone.Type is access mode, not an ID. */
export function edgeOneAccessLabel(type?: string) {
  const key = String(type || '')
  const map: Record<string, string> = {
    dnsPodAccess: 'DNSPod 接入',
    partial: 'CNAME 接入',
    full: '全量接入',
    noDomainAccess: '无域名接入',
    pages: 'Pages',
    ai: 'AI',
  }
  return map[key] || map[key.toLowerCase()] || key || '-'
}

export function certificateStatusLabel(status?: string) {
  const key = String(status || '').toLowerCase()
  return (
    {
      applying: '申请中',
      deployed: '已部署',
      processing: '部署中',
      failed: '申请失败',
    }[key] ||
    status ||
    '-'
  )
}
