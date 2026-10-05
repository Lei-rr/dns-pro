import http, { withRefresh } from '@/shared/api/http'
import type { ApiResponse } from '@/shared/api/types'
import type { AuditEvent, ReconcileReport, ReconcileResult, ReconcileScope } from '../model/types'

/** scope → 查询参数：空值不下发，保持后端 schema 的 additionalProperties:false 语义 */
function scopeParams(scope: ReconcileScope = {}): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  if (scope.providerId) params.provider_id = scope.providerId
  if (scope.kind) params.kind = scope.kind
  return params
}

/** 读接口选项：signal 由 useResourceQuery 的 queryFn 注入 */
type ReadOptions = { refresh?: boolean; signal?: AbortSignal }

export const syncApi = {
  /** 只读检测：返回派生记录的健康状态（无远端写） */
  detect: (scope: ReconcileScope = {}, options: ReadOptions = {}): Promise<ApiResponse<ReconcileReport>> =>
    http.get<ReconcileReport>('/reconcile', {
      ...withRefresh({ refresh: options.refresh, params: scopeParams(scope) }),
      signal: options.signal,
    }),
  /** 执行对账：经统一写入器补齐 create/update，天然继承所有权门禁 */
  apply: (scope: ReconcileScope = {}): Promise<ApiResponse<ReconcileResult>> =>
    http.post<ReconcileResult>('/reconcile', scopeParams(scope)),
  /** F6 审计留痕：最近关键操作 */
  audit: (options: ReadOptions = {}): Promise<ApiResponse<{ items: AuditEvent[] }>> =>
    http.get<{ items: AuditEvent[] }>('/audit', {
      ...withRefresh({ refresh: options.refresh }),
      signal: options.signal,
    }),
}
