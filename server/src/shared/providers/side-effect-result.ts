import { ApiError } from '../http/api-error.js'
import { errorMessage } from '../lib/values.js'

type SideEffectStatus = 'completed' | 'skipped' | 'failed'

export interface DnsSideEffect {
  [key: string]: unknown
  status: SideEffectStatus
  message: string
  details: unknown[]
}

export interface SideEffects {
  dns?: { sync?: DnsSideEffect; cleanup?: DnsSideEffect }
  tunnel?: { token?: DnsSideEffect }
  local?: { preference?: DnsSideEffect }
}

/** DNS 单步操作结果（隧道 CNAME 等） */
export interface DnsOperationResult {
  [key: string]: unknown
  action: string
  message?: string
  error?: unknown
}

export function buildDnsSideEffects(effects: { sync?: DnsSideEffect; cleanup?: DnsSideEffect }): SideEffects {
  const dns: NonNullable<SideEffects['dns']> = {}
  if (effects.sync) dns.sync = effects.sync
  if (effects.cleanup) dns.cleanup = effects.cleanup
  return { dns }
}

/** 递归检查结果中是否有失败项 */
function hasFailedSideEffectItem(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasFailedSideEffectItem)
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.status === 'failed' || record.action === 'failed') return true
  return ['record', 'records', 'deleted', 'precleaned'].some((field) => hasFailedSideEffectItem(record[field]))
}

export function fromDnsOperationResult(result: DnsOperationResult, defaultMessage: string): DnsSideEffect {
  const action = String(result.action ?? 'unknown')
  const status: SideEffectStatus =
    action === 'failed' || hasFailedSideEffectItem(result)
      ? 'failed'
      : ['skipped', 'kept', 'not_found'].includes(action)
        ? 'skipped'
        : 'completed'
  return { status, message: String(result.message ?? result.error ?? defaultMessage), details: [result] }
}

/** 执行 DNS 副作用；异常转为 failed 结果，不阻断主流程 */
export async function runDnsSideEffect(fn: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
  try {
    return await fn()
  } catch (error) {
    return {
      status: 'failed',
      code: error instanceof ApiError ? error.code : 'dns_sync_failed',
      message: errorMessage(error),
    }
  }
}

/** 同步结果 → 副作用摘要 */
export function toSyncSideEffect(result: Record<string, unknown>, defaultMessage: string): DnsSideEffect {
  let status = String(result.status ?? '') as SideEffectStatus | ''
  if (status === '' || status === 'completed') {
    if (hasFailedSideEffectItem(result)) status = 'failed'
    else if (status === '') {
      const hasRecords = Array.isArray(result.records) ? result.records.length > 0 : Boolean(result.record)
      status = !hasRecords && (result.reason || result.code) ? 'skipped' : 'completed'
    }
  }
  return { status: status as SideEffectStatus, message: String(result.message ?? defaultMessage), details: [result] }
}

/** 清理结果 → 副作用摘要；失败永不折叠为 skipped */
export function toCleanupSideEffect(result: Record<string, unknown>, defaultMessage: string): DnsSideEffect {
  if (result.status === 'failed' || hasFailedSideEffectItem(result)) {
    return { status: 'failed', message: String(result.message ?? 'DNS 清理失败'), details: [result] }
  }
  const cleaned = Number(result.cleaned ?? 0)
  const status: SideEffectStatus =
    result.status === 'skipped' || result.reason || cleaned <= 0 ? 'skipped' : 'completed'
  const fallback =
    status === 'completed' ? defaultMessage : result.reason ? 'DNS 清理已跳过' : '未找到需要清理的 DNS 记录'
  return { status, message: String(result.message ?? fallback), details: [result] }
}
