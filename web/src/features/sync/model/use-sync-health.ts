import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation } from '@tanstack/vue-query'
import { useResourceQuery } from '@/shared/query'
import { syncApi } from '../api/sync-api'
import type {
  AuditEvent,
  ReconcileItem,
  ReconcileReport,
  ReconcileResult,
  ReconcileScope,
  ReconcileSummary,
} from './types'

const EMPTY_SUMMARY: ReconcileSummary = { total: 0, synced: 0, drifted: 0, missing: 0, failed: 0 }

/**
 * F1 同步健康视图：全部派生关系（SaaS 主机名 / 隧道路由 / EdgeOne 加速域名）的只读检测。
 * 只读检测不产生任何远端写，修复必须显式触发 useReconcileRepair。
 */
export function useSyncHealthQuery(scope: MaybeRefOrGetter<ReconcileScope> = {}) {
  const query = useResourceQuery<ReconcileReport>({
    key: () => ['sync', 'health', toValue(scope).providerId ?? '', toValue(scope).kind ?? ''],
    queryFn: async ({ refresh, signal }) => (await syncApi.detect(toValue(scope), { refresh, signal })).data,
    refreshNotice: '同步状态已刷新',
  })

  return {
    items: computed<ReconcileItem[]>(() => query.data.value?.items ?? []),
    summary: computed<ReconcileSummary>(() => query.data.value?.summary ?? EMPTY_SUMMARY),
    scannedAt: computed(() => query.data.value?.scanned_at ?? ''),
    loading: query.loading,
    refreshing: query.refreshing,
    refresh: query.refresh,
  }
}

/** F1 一键修复 / F2 执行入口：同一语义经 POST /reconcile，执行后由调用方显式刷新健康视图 */
export function useReconcileRepair() {
  const mutation = useMutation({ mutationFn: async (scope: ReconcileScope) => (await syncApi.apply(scope)).data })

  return {
    // 不再在此 invalidate：调用方拿到结果后必然 refresh()，两处叠加会触发两轮全量检测扫描
    repair: (scope: ReconcileScope = {}): Promise<ReconcileResult> => mutation.mutateAsync(scope),
    repairing: computed(() => mutation.isPending.value),
  }
}

/** F6 审计留痕读路径：最近的关键操作（批量 / 凭据变更 / 会话吊销） */
export function useAuditTrailQuery() {
  const query = useResourceQuery<AuditEvent[]>({
    key: () => ['sync', 'audit'],
    queryFn: async ({ refresh, signal }) => (await syncApi.audit({ refresh, signal })).data.items ?? [],
    refreshNotice: '',
  })

  return {
    events: computed<AuditEvent[]>(() => query.data.value ?? []),
    loading: query.loading,
    refresh: query.refresh,
  }
}
