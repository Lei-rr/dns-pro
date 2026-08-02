export function isProviderSecretField(field: string): boolean {
  return /key|token|secret|password/i.test(field)
}
