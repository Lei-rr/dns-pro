export interface DnsSideEffect {
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
