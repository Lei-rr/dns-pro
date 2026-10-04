const ERROR_MESSAGE_MAP: Record<string, string> = {
  // 鉴权
  unauthenticated: '请先登录',
  invalid_credentials: '用户名或密码不正确',
  password_change_required: '仍在使用默认账号密码，请先修改密码',
  password_too_weak: '新密码强度不足',
  auth_rate_limited: '登录失败次数过多，请稍后重试',

  // 通用
  validation_failed: '参数校验未通过',
  not_found: '接口不存在',
  http_error: '请求失败',
  server_error: '服务内部错误',
  dns_provider_unsupported: '不支持的 DNS 服务商',
  credential_decrypt_failed: '凭据解密失败：密钥文件（credential.key）可能已丢失或被替换',
  internal_error: '服务内部错误',
  request_error: '请求错误',
  invalid_upstream_path: '请求参数包含非法路径字符',
  provider_rate_limited: '服务商接口限流，请稍后重试',
  csrf_rejected: '请求来源校验失败，请刷新页面后重试',
  validation_error: '参数校验失败',
  health_check_failed: '健康检查失败',
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
  provider_exists: '该服务商标识已存在',
  provider_type_immutable: '服务商类型不能修改',
  provider_order_duplicated: '排序列表中存在重复的服务商',
  provider_order_mismatch: '排序列表与现有服务商不匹配',
  provider_in_use: '该服务商仍在被使用，无法删除',
  provider_reference_cycle: '服务商引用形成循环，请检查关联配置',
  provider_reference_not_found: '关联的服务商不存在',
  provider_reference_type_mismatch: '关联服务商类型不匹配',

  // Cloudflare
  cloudflare_provider_not_found: 'Cloudflare 服务商不存在',
  cloudflare_account_id_required: 'Cloudflare 账户 ID 不能为空',
  cloudflare_zone_not_found: 'Cloudflare 站点不存在',
  cloudflare_connection_failed: 'Cloudflare 连接失败',
  cloudflare_invalid_response: 'Cloudflare 返回数据无效',
  cloudflare_request_failed: 'Cloudflare 请求失败',
  cloudflare_pagination_limit: 'Cloudflare 返回页数超过安全上限',

  // DNSPod
  dnspod_provider_not_found: 'DNSPod 服务商不存在',
  dnspod_provider_missing: '未配置关联的 DNSPod 服务商',
  dnspod_record_create_failed: 'DNSPod 记录创建失败',
  dnspod_record_update_failed: 'DNSPod 记录更新失败',
  dnspod_record_delete_failed: 'DNSPod 记录删除失败',
  dnspod_record_list_failed: 'DNSPod 记录列表获取失败',
  dnspod_line_list_failed: 'DNSPod 线路列表获取失败',
  dnspod_zone_create_failed: 'DNSPod 域名添加失败',
  dnspod_zone_delete_failed: 'DNSPod 域名删除失败',
  dnspod_zone_list_failed: 'DNSPod 域名列表获取失败',
  dnspod_pagination_limit: 'DNSPod 返回页数超过安全上限',
  dnspod_invalid_response: 'DNSPod 返回数据无效',

  // EdgeOne
  edgeone_provider_not_found: 'EdgeOne 服务商不存在',
  edgeone_dnspod_provider_not_found: '关联的 DNSPod 服务商不存在',
  edgeone_zone_not_found: 'EdgeOne 站点不存在',
  edgeone_zone_list_failed: 'EdgeOne 站点列表获取失败',
  edgeone_cname_empty: 'EdgeOne 加速域名尚未生成 CNAME',
  edgeone_acceleration_domain_not_found: 'EdgeOne 加速域名不存在',
  edgeone_request_failed: 'EdgeOne 请求失败',
  edgeone_pagination_limit: 'EdgeOne 返回页数超过安全上限',
  edgeone_invalid_response: 'EdgeOne 返回数据无效',

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
  saas_not_active: '该主机名当前未激活',
  saas_hostname_not_found: 'SaaS 主机名不存在',

  // Preferred Domain
  preferred_domain_duplicate: '该优选域名已存在',
  preferred_domain_invalid: '域名格式不正确',
  preferred_domain_not_found: '优选域名不存在',
  preferred_domain_not_allowed: '该域名不在优选域名列表中',

  // Preferred apply / jobs
  preferred_apply_empty: '没有匹配的主机名可切换',
  preferred_apply_not_found: '优选切换任务不存在',
  dns_sync_failed: 'DNS 写回失败，请检查关联 DNS 服务商与权限',

  // 常见厂商错误补充
  saas_cloudflare_sync_zone_mismatch: 'Cloudflare DNS 同步域名与主机名不匹配，请检查同步目标',
  provider_test_failed: '服务商连接测试失败',
  provider_credentials_invalid: '密钥无效或权限不足',
  forbidden: '权限不足，请检查服务商权限范围',

  // Fallback origin
  fallback_origin_invalid: '默认回源必须是当前站点的有效子域名',

  // Cloudflared
  cloudflared_provider_not_found: 'Cloudflare Tunnel 服务商不存在',
  cloudflared_cloudflare_provider_missing: 'Cloudflare Tunnel 未关联 Cloudflare 服务商',
  cloudflared_account_id_required: 'Cloudflare Tunnel 需要账户 ID',
  cloudflared_route_exists: '该路由已存在',
  cloudflared_route_not_found: '路由不存在',
  cloudflared_route_invalid: '路由参数不正确',
  cloudflared_pagination_limit: 'Cloudflare Tunnel 返回页数超过安全上限',
  cloudflared_tunnel_token_invalid: 'Cloudflare Tunnel 返回的令牌无效',
  cloudflared_zone_not_found: '找不到与该主机名匹配的 Cloudflare 站点',
}

export function translateError(code: string): string | null {
  return ERROR_MESSAGE_MAP[code] ?? null
}
