/** 列表每页条数本地记忆（10/20/50/100） */

const DEFAULT_SIZE = 20
const ALLOWED = new Set([10, 20, 50, 100])

function storageKey(scope: string) {
  return `dns-pro:page-size:${scope}`
}

export function loadPageSize(scope: string, fallback = DEFAULT_SIZE): number {
  try {
    const raw = localStorage.getItem(storageKey(scope))
    const n = Number(raw)
    if (ALLOWED.has(n)) return n
  } catch {
    // ignore
  }
  return ALLOWED.has(fallback) ? fallback : DEFAULT_SIZE
}

export function savePageSize(scope: string, size: number) {
  if (!ALLOWED.has(size)) return
  try {
    localStorage.setItem(storageKey(scope), String(size))
  } catch {
    // ignore
  }
}
