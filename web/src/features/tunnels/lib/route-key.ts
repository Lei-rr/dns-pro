import type { TunnelRoute } from '../model/types'

/** hostname + path 唯一确定一条 ingress 规则：行 key、busy key 与表格身份共用此口径 */
export function routeKey(record: TunnelRoute) {
  return `${record.hostname}|${record.path}`
}
