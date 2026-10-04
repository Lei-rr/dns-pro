import { dnsRecordMatches, type DnsRecordPort, type DnsRecordValue } from '../../kernel/contracts/dns-record.port.js'

/** 站点定位：批量条目归属的服务商与站点 */
type RecordScope = { providerId: string; zone: string }

/**
 * 批量添加的幂等判定：create 默认全查重。
 * 手动重提交与自动重试走同一路径——目标记录已存在时跳过，不再重复创建。
 */
export async function findExistingRecord(
  port: DnsRecordPort,
  scope: RecordScope,
  value: DnsRecordValue
): Promise<{ id: string } | null> {
  const candidates = await port.find(scope.providerId, scope.zone, value)
  // 端口返回值已归一化，比较不涉及厂商字段
  return candidates.find((ref) => dnsRecordMatches(ref.value, value)) ?? null
}
