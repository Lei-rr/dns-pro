/**
 * EdgeOne 加速域名 → 期望 DNS 记录（§4.2 planner）。
 *
 * 加速域名是来源，关联 DNSPod 账号下的 CNAME 是派生投影。
 * 期望记录构造同时被 EdgeOne 同步工作流复用（写入与 repair 同一判据）。
 */
import { DNSPOD_DEFAULT_LINE } from './saas-records.planner.js'
import type { DesiredRecord } from '../sync-plan.js'

/** EdgeOne 同步解析的 TTL 默认值 */
const EDGEONE_CNAME_TTL = 600

/** EdgeOne CNAME 期望记录（同步写入与 repair 共用同一判据） */
export function edgeOneCnameDesired(fqdn: string, cname: string): DesiredRecord {
  return {
    purpose: 'edgeone_cname',
    fqdn,
    owner: 'edgeone',
    refId: fqdn,
    record: {
      type: 'CNAME',
      value: cname,
      line: DNSPOD_DEFAULT_LINE,
      note: `EdgeOne 加速丨${fqdn}`,
      ttl: EDGEONE_CNAME_TTL,
    },
  }
}
