import type { SaaSHostname } from '../model/types'

/** 行 key、勾选集合与 busy 门控共用同一口径：hostname 优先，缺失时回退 id */
export function hostnameKey(record: SaaSHostname) {
  return String(record.hostname || record.id || '')
}
