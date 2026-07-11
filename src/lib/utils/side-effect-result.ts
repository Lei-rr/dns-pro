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
}

export function completed(message: string, details: unknown[] = []): DnsSideEffect {
  return { status: 'completed', message, details }
}

export function skipped(message: string, details: unknown[] = []): DnsSideEffect {
  return { status: 'skipped', message, details }
}

export function failed(message: string, details: unknown[] = []): DnsSideEffect {
  return { status: 'failed', message, details }
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
    action === 'failed' ? 'failed' : ['skipped', 'kept', 'not_found'].includes(action) ? 'skipped' : 'completed'
  return {
    status,
    message: String(result.message ?? result.error ?? defaultMessage),
    details: [result],
  }
}
