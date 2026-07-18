export function parseRecordNames(value: unknown): string[] {
  const seen = new Set<string>()
  const names: string[] = []

  for (const raw of String(value ?? '').split(/[,，]/)) {
    const name = raw.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }

  return names
}
