const CODE_HINTS: Record<string, string> = {
  saas_cloudflare_sync_zone_mismatch: 'Cloudflare DNS 同步域名与主机名不匹配，请到编辑页检查同步目标',
  saas_dnspod_provider_missing: 'SaaS 未关联 DNSPod，请先在服务商设置里绑定',
  saas_dnspod_zone_not_found: 'DNSPod 中找不到匹配域名，请确认主域名已接入 DNSPod',
  preferred_apply_running: '已有优选切换任务在跑，请稍后再试',
  preferred_apply_empty: '没有匹配主机可切换（可取消“仅自动优选”）',
  cloudflare_provider_not_found: 'Cloudflare 服务商不存在或已删除',
  dnspod_provider_not_found: 'DNSPod 服务商不存在或已删除',
  edgeone_cname_empty: 'EdgeOne 尚未生成 CNAME，请稍后刷新再同步',
  validation_failed: '参数不完整或格式不正确',
  unauthenticated: '登录已失效，请重新登录',
}

export function errorMessage(error: unknown, fallback = '请求失败'): string {
  if (typeof error === 'string' && error.trim()) return error

  const err = error as {
    message?: string
    code?: string
    response?: { data?: { message?: string; code?: string; details?: unknown } }
  }

  const code = String(err?.code || err?.response?.data?.code || '').trim()
  const serverMessage = String(err?.response?.data?.message || err?.message || '').trim()

  if (code && CODE_HINTS[code]) return CODE_HINTS[code]
  if (serverMessage) {
    // append actionable hint when we recognize partial text
    if (/sync zone/i.test(serverMessage) || /does not match hostname/i.test(serverMessage)) {
      return 'DNS 同步域名与主机名不匹配，请检查同步目标（通常应为 guolei.cc 这类主域名，而不是 SaaS 区）'
    }
    if (/permission|unauthorized|forbidden/i.test(serverMessage)) {
      return `${serverMessage}（请检查 API Token / 密钥权限）`
    }
    if (/rate|too many|throttl/i.test(serverMessage)) {
      return `${serverMessage}（请求过快，请稍后重试）`
    }
    return serverMessage
  }

  return fallback
}
