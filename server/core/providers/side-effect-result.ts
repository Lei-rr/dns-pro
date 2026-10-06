import { ApiError } from '../http/api-error.js'
import { errorMessage } from '../../shared/values.js'

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

/** 同步结果 → 副作用摘要；状态值经白名单归一，非法值（含上游自造串）按记录内容推断 */
export function toSyncSideEffect(result: Record<string, unknown>, defaultMessage: string): DnsSideEffect {
  const raw = String(result.status ?? '')
  let status: SideEffectStatus
  if (raw === 'failed' || raw === 'skipped') {
    status = raw
  } else if (raw === 'completed') {
    status = hasFailedSideEffectItem(result) ? 'failed' : 'completed'
  } else if (hasFailedSideEffectItem(result)) {
    status = 'failed'
  } else {
    const hasRecords = Array.isArray(result.records) ? result.records.length > 0 : Boolean(result.record)
    status = !hasRecords && (result.reason || result.code) ? 'skipped' : 'completed'
  }
  return { status, message: String(result.message ?? defaultMessage), details: [result] }
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

/** 普通对象判定：数组、null、原始值都不算 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSideEffectStatus(value: string): value is SideEffectStatus {
  return value === 'completed' || value === 'skipped' || value === 'failed'
}

/** 逐字段校验副作用摘要：结构不符（旧数据 / 手工构造）返回 undefined，不做类型断言 */
function parseDnsSideEffect(value: unknown): DnsSideEffect | undefined {
  if (!isRecord(value)) return undefined
  const status = typeof value.status === 'string' ? value.status : ''
  if (!isSideEffectStatus(status)) return undefined
  return {
    ...value,
    status,
    message: String(value.message ?? ''),
    details: Array.isArray(value.details) ? value.details : [],
  }
}

/**
 * 结果里的副作用分组：逐组校验后重建，越界结构一律忽略。
 * 断言式读取会把脏结构一路带进条目消息，读取方反而以为自己拿到的是 SideEffects。
 */
export function sideEffectsOf(result: Record<string, unknown>): SideEffects {
  const effects: SideEffects = {}
  const raw = result.side_effects
  if (!isRecord(raw)) return effects
  if (isRecord(raw.dns)) {
    const sync = parseDnsSideEffect(raw.dns.sync)
    const cleanup = parseDnsSideEffect(raw.dns.cleanup)
    if (sync || cleanup) effects.dns = { ...(sync ? { sync } : {}), ...(cleanup ? { cleanup } : {}) }
  }
  if (isRecord(raw.tunnel)) {
    const token = parseDnsSideEffect(raw.tunnel.token)
    if (token) effects.tunnel = { token }
  }
  if (isRecord(raw.local)) {
    const preference = parseDnsSideEffect(raw.local.preference)
    if (preference) effects.local = { preference }
  }
  return effects
}

/** 从批量条目结果中读取 DNS 副作用 */
export function dnsEffectOf(result: Record<string, unknown>, kind: 'sync' | 'cleanup'): DnsSideEffect | undefined {
  return sideEffectsOf(result).dns?.[kind]
}

/** DNS 副作用 → 条目消息后缀 */
export function dnsEffectNote(effect: DnsSideEffect | undefined, done: string): string {
  if (effect?.status === 'completed') return `（${done}）`
  if (effect?.status === 'skipped') return `（DNS 跳过：${effect.message || '已跳过'}）`
  return ''
}
