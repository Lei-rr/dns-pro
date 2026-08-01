export type DnsSideEffectKind = 'sync' | 'cleanup'

export interface DnsSideEffectData {
  status?: string
  message?: string
  [key: string]: unknown
}

/** Read DNS side effects from the business result inside the API data envelope. */
export function dnsSideEffectFromData(response: unknown, kind: DnsSideEffectKind): DnsSideEffectData | undefined {
  if (!response || typeof response !== 'object') return undefined
  const data = (response as { data?: unknown }).data
  if (!data || typeof data !== 'object') return undefined
  const sideEffects = (data as { side_effects?: unknown }).side_effects
  if (!sideEffects || typeof sideEffects !== 'object') return undefined
  const dns = (sideEffects as { dns?: unknown }).dns
  if (!dns || typeof dns !== 'object') return undefined
  const operation = (dns as Record<DnsSideEffectKind, unknown>)[kind]
  return operation && typeof operation === 'object' ? (operation as DnsSideEffectData) : undefined
}
