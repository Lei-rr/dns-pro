export function uniqueFilters(values: unknown[]) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && String(value) !== ''))]
    .sort((a, b) => String(a).localeCompare(String(b)))
    .map((value) => ({ text: String(value), value }))
}

export function regionName(regions: Record<string, string> | undefined, id: string): string {
  return regions && regions[id] ? regions[id] : id
}
