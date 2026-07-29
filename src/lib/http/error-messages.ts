const ERROR_MESSAGE_MAP: Record<string, string> = {
  // 鉴权
  unauthenticated: '请先登录',
  invalid_credentials: '用户名或密码不正确',

  // 通用
  validation_failed: '参数校验未通过',
  not_found: '接口不存在',
  http_error: '请求失败',
  server_error: '服务内部错误',
  sync_skipped: '同步已跳过',
  internal_error: '服务内部错误',
  request_error: '请求错误',
  validation_error: '参数校验失败',
  service_unavailable: '服务暂时不可用，请稍后重试',
  health_check_failed: '健康检查失败',
  service_not_registered: '服务未注册（平台模块装载异常）',
  job_not_found: '任务不存在',
  job_running: '任务仍在执行中',
  batch_empty: '未选择任何目标',
  batch_patch_empty: '没有可修改的字段',
  batch_job_running: '该站点已有批量任务在执行',
  batch_job_not_found: '批量任务不存在',
  batch_no_failed: '没有失败项可重试',
  batch_provider_unsupported: '当前服务商不支持该批量操作',

  // Provider 通用
  provider_not_found: '服务商不存在',
  provider_not_configured: '服务商尚未配置完整',
  provider_exists: '该服务商标识已存在',
  provider_type_immutable: '服务商类型不能修改',
  provider_order_duplicated: '排序列表中存在重复的服务商',
  provider_order_mismatch: '排序列表与现有服务商不匹配',
  provider_in_use: '该服务商仍在被使用，无法删除',

  // Cloudflare
  cloudflare_provider_not_found: 'Cloudflare 服务商不存在',
  cloudflare_account_id_required: 'Cloudflare 账户 ID 不能为空',
  cloudflare_zone_not_found: 'Cloudflare 站点不存在',
  cloudflare_connection_failed: 'Cloudflare 连接失败',
  cloudflare_invalid_response: 'Cloudflare 返回数据无效',
  cloudflare_request_failed: 'Cloudflare 请求失败',

  // DNSPod
  dnspod_provider_not_found: 'DNSPod 服务商不存在',
  dnspod_provider_missing: '未配置关联的 DNSPod 服务商',
  dnspod_record_conflict: 'DNSPod 已存在冲突的记录类型',
  dnspod_record_conflict_multiple: 'DNSPod 存在多条匹配的记录，无法自动同步',
  dnspod_record_id_missing: 'DNSPod 记录 ID 缺失',
  dnspod_record_create_failed: 'DNSPod 记录创建失败',
  dnspod_record_update_failed: 'DNSPod 记录更新失败',
  dnspod_record_delete_failed: 'DNSPod 记录删除失败',
  dnspod_record_list_failed: 'DNSPod 记录列表获取失败',
  dnspod_zone_create_failed: 'DNSPod 域名添加失败',
  dnspod_zone_delete_failed: 'DNSPod 域名删除失败',
  dnspod_zone_list_failed: 'DNSPod 域名列表获取失败',

  // EdgeOne
  edgeone_provider_not_found: 'EdgeOne 服务商不存在',
  edgeone_dnspod_provider_not_found: '关联的 DNSPod 服务商不存在',
  edgeone_zone_not_found: 'EdgeOne 站点不存在',
  edgeone_zone_list_failed: 'EdgeOne 站点列表获取失败',
  edgeone_cname_empty: 'EdgeOne 加速域名尚未生成 CNAME',
  edgeone_domain_zone_mismatch: '加速域名不属于该 DNSPod 域名',
  edgeone_acceleration_domain_not_found: 'EdgeOne 加速域名不存在',
  edgeone_acceleration_domain_create_failed: 'EdgeOne 加速域名创建失败',
  edgeone_acceleration_domain_update_failed: 'EdgeOne 加速域名更新失败',
  edgeone_acceleration_domain_delete_failed: 'EdgeOne 加速域名删除失败',
  edgeone_acceleration_domain_list_failed: 'EdgeOne 加速域名列表获取失败',
  edgeone_acceleration_domain_status_update_failed: 'EdgeOne 加速域名状态修改失败',
  edgeone_certificate_update_failed: 'EdgeOne 证书更新失败',
  edgeone_request_failed: 'EdgeOne 请求失败',

  // SaaS
  saas_provider_not_found: 'SaaS 服务商不存在',
  saas_cloudflare_provider_missing: 'SaaS 未关联 Cloudflare 服务商',
  saas_cloudflare_dns_provider_missing: 'SaaS 未关联 Cloudflare DNS 服务商',
  saas_cloudflare_sync_zone_missing: '未选择 Cloudflare DNS 同步域名',
  saas_business_target_missing: '缺少业务主 CNAME 的目标域名',
  saas_dnspod_provider_missing: 'SaaS 未关联 DNSPod 服务商',
  saas_dnspod_zone_not_found: 'DNSPod 中找不到与该主机名匹配的域名',
  saas_fqdn_empty: '主机名 FQDN 为空',
  saas_fqdn_missing: '主机名 FQDN 缺失',
  saas_no_sync_records: '该主机名当前没有可同步的 DNS 记录',
  saas_not_active: '该主机名当前未激活',
  saas_hostname_not_found: 'SaaS 主机名不存在',
  cloudflare_dns_record_conflict: 'Cloudflare DNS 中已存在冲突记录',

  // Preferred Domain
  preferred_domain_duplicate: '该优选域名已存在',
  preferred_domain_invalid: '域名格式不正确',
  preferred_domain_not_found: '优选域名不存在',
  preferred_domain_not_allowed: '该域名不在优选域名列表中',

  // Preferred apply / jobs
  preferred_apply_running: '已有优选切换任务在执行，请稍后再试',
  preferred_apply_empty: '没有匹配的主机名可切换',
  preferred_apply_not_found: '优选切换任务不存在',
  preferred_apply_no_failed: '没有失败项可重试',
  dns_sync_failed: 'DNS 写回失败，请检查关联 DNS 服务商与权限',

  // 常见厂商错误补充
  saas_cloudflare_sync_zone_mismatch: 'Cloudflare DNS 同步域名与主机名不匹配，请检查同步目标',
  cloudflare_permission_denied: 'Cloudflare 权限不足，请检查 API Token 权限',
  dnspod_permission_denied: 'DNSPod 权限不足，请检查密钥权限',
  dnspod_record_not_found: 'DNSPod 记录不存在或已被删除',
  provider_api_error: '服务商接口返回错误，请稍后重试或检查配置',
  provider_test_unsupported: '该服务商类型暂不支持测通',
  provider_test_failed: '服务商连接测试失败',
  provider_credentials_invalid: '密钥无效或权限不足',
  invalid_access: '密钥无效或权限不足',
  auth_failure: '认证失败，请检查密钥',
  unauthorized: '未授权，请检查 API Token / 密钥',
  forbidden: '权限不足，请检查服务商权限范围',

  // Fallback origin
  fallback_origin_zone_mismatch: '默认回源必须是该站点的子域名',

  // Cloudflared
  cloudflared_provider_not_found: 'Cloudflare Tunnel 服务商不存在',
  cloudflared_cloudflare_provider_missing: 'Cloudflare Tunnel 未关联 Cloudflare 服务商',
  cloudflared_account_id_required: 'Cloudflare Tunnel 需要账户 ID',
  cloudflared_route_exists: '该路由已存在',
  cloudflared_route_not_found: '路由不存在',
  cloudflared_route_invalid: '路由参数不正确',
}

export function translateError(code: string): string | null {
  return ERROR_MESSAGE_MAP[code] ?? null
}
