/** Normalize a hostname/FQDN: drop surrounding blanks, lowercase, strip one trailing dot. */
export function normalizeFqdn(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
}
