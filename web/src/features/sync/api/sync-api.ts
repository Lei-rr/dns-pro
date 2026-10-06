import http, { unwrapItem, unwrapList, withRefresh } from '@/shared/api/http'
import type { ApiResponse } from '@/shared/api/types'
import type { AuditEvent, ReconcileReport, ReconcileResult, ReconcileScope } from '../model/types'

/** scope → 查询参数：空值不下发，保持后端 schema 的 additionalProperties:false 语义 */
function scopeParams(scope: ReconcileScope = {}): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  if (scope.providerId) params.provider_id = scope.providerId
  if (scope.kind) params.kind = scope.kind
  return params
}

/** 契约守卫：检测报告必须带 items 数组与 summary 对象（形状不符由解包器抛错，不透传） */
function isReconcileReport(value: unknown): value is ReconcileReport {
  if (typeof value !== 'object' || value === null) return false
  if (!('items' in value) || !Array.isArray(value.items)) return false
  return 'summary' in value && typeof value.summary === 'object' && value.summary !== null
}

function isReconcileResult(value: unknown): value is ReconcileResult {
  return isReconcileReport(value) && 'results' in value && Array.isArray(value.results)
}

/** 读接口选项：signal 由 useResourceQuery 的 queryFn 注入 */
type ReadOptions = { refresh?: boolean; signal?: AbortSignal }

export const syncApi = {
  /** 只读检测：返回派生记录的健康状态（无远端写） */
  detect: async (scope: ReconcileScope = {}, options: ReadOptions = {}): Promise<ApiResponse<ReconcileReport>> =>
    unwrapItem(
      await http.get('/reconcile', {
        ...withRefresh({ refresh: options.refresh, params: scopeParams(scope) }),
        signal: options.signal,
      }),
      isReconcileReport
    ),
  /** 执行对账：经统一写入器补齐 create/update，天然继承所有权门禁 */
  apply: async (scope: ReconcileScope = {}): Promise<ApiResponse<ReconcileResult>> =>
    unwrapItem(await http.post('/reconcile', scopeParams(scope)), isReconcileResult),
  /** F6 审计留痕：最近关键操作 */
  audit: async (options: ReadOptions = {}): Promise<ApiResponse<AuditEvent[]>> =>
    unwrapList<AuditEvent>(
      await http.get('/audit', {
        ...withRefresh({ refresh: options.refresh }),
        signal: options.signal,
      })
    ),
}
