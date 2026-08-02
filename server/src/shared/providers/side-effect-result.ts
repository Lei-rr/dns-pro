export interface DnsSideEffect {
  [key: string]: unknown
  status: 'completed' | 'skipped' | 'failed'
  message: string
  details: unknown[]
}

export interface SideEffects {
  dns?: {
    sync?: DnsSideEffect
    cleanup?: DnsSideEffect
  }
  tunnel?: {
    token?: DnsSideEffect
  }
  local?: {
    preference?: DnsSideEffect
  }
}

export function buildDnsSideEffects(effects: { sync?: DnsSideEffect; cleanup?: DnsSideEffect }): SideEffects {
  const dns: NonNullable<SideEffects['dns']> = {}
  if (effects.sync) dns.sync = effects.sync
  if (effects.cleanup) dns.cleanup = effects.cleanup
  return { dns }
}

export function completed(message: string, details: unknown[] = []): DnsSideEffect {
  return { status: 'completed', message, details }
}

export interface DnsOperationResult {
  [key: string]: unknown
  action: string
  message?: string
  error?: unknown
}

export function fromDnsOperationResult(result: DnsOperationResult, defaultMessage: string): DnsSideEffect {
  const action = String(result.action ?? 'unknown')
  const status =
    action === 'failed' || hasFailedSideEffectItem(result)
      ? 'failed'
      : ['skipped', 'kept', 'not_found'].includes(action)
        ? 'skipped'
        : 'completed'
  return {
    status,
    message: String(result.message ?? result.error ?? defaultMessage),
    details: [result],
  }
}

export function hasFailedSideEffectItem(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasFailedSideEffectItem)
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.status === 'failed' || record.action === 'failed') return true
  return ['record', 'records', 'deleted', 'precleaned'].some((field) => hasFailedSideEffectItem(record[field]))
}
