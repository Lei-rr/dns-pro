export function providerString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

export function providerOptionalString(value: unknown): string | undefined {
  const result = providerString(value)
  return result === '' && value !== '' ? undefined : result
}

export function providerNullableString(value: unknown): string | null {
  return value == null ? null : providerString(value)
}

export function providerFiniteNumber(value: unknown, fallback = 0): number {
  const result = Number(value)
  return Number.isFinite(result) ? result : fallback
}

export function providerNullableNumber(value: unknown): number | null {
  return value == null ? null : providerFiniteNumber(value)
}
