import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useResourceQuery } from '@/shared/query'
import { dnsApi, type DnsProviderRef } from '../api/dns-api'
import type { DnsLineOption, DnsRecord } from '../model/types'

/** 线路随域名套餐变化，从 DNSPod 拉取；拉取失败时退回常用线路 */
const FALLBACK_LINE_OPTIONS: DnsLineOption[] = [
  { label: '默认', value: '默认' },
  { label: '境内', value: '境内' },
  { label: '境外', value: '境外' },
]

/** DNS 记录列表读路径：query key 由 provider + zone 派生，切换作用域即自然隔离在飞请求。 */
export function useDnsRecordsQuery(provider: MaybeRefOrGetter<DnsProviderRef>, zoneId: MaybeRefOrGetter<string>) {
  const query = useResourceQuery<DnsRecord[]>({
    key: () => ['dns', 'records', toValue(provider).id, toValue(provider).type, toValue(zoneId)],
    queryFn: async ({ refresh, signal }) =>
      (await dnsApi.records(toValue(provider), toValue(zoneId), { refresh, signal })).data,
    pageSizeScope: 'dns-records',
  })

  return {
    records: computed(() => query.data.value ?? []),
    /** 读失败标记：必须透出到渲染路径，否则未定义数据会被折算成空列表、失败被误渲染成空态 */
    error: query.error,
    loading: query.loading,
    refreshing: query.refreshing,
    pageSize: query.pageSize,
    setPageSize: query.setPageSize,
    refresh: query.refresh,
    invalidate: query.invalidate,
  }
}

/** DNSPod 解析线路：Cloudflare 无线路概念，直接返回兜底列表。 */
export function useDnsLinesQuery(options: {
  provider: MaybeRefOrGetter<DnsProviderRef>
  zoneName: MaybeRefOrGetter<string>
  cloudflare: MaybeRefOrGetter<boolean>
}) {
  const query = useResourceQuery<DnsLineOption[]>({
    key: () => [
      'dns',
      'lines',
      toValue(options.provider).id,
      toValue(options.provider).type,
      toValue(options.zoneName),
    ],
    queryFn: async ({ refresh, signal }) => {
      if (toValue(options.cloudflare)) return []
      try {
        const { items, groups } = (
          await dnsApi.lines(toValue(options.provider), toValue(options.zoneName), { refresh, signal })
        ).data
        return [
          ...items.map((line) => ({ label: line.name, value: line.name, lineId: line.line_id })),
          // 分组（境内/境外等）按名称提交
          ...groups
            .filter((group) => group.name && !items.some((line) => line.name === group.name))
            .map((group) => ({ label: group.name, value: group.name })),
        ]
      } catch {
        // 线路获取失败不阻断记录管理，退回常用线路
        return []
      }
    },
    refreshNotice: '',
  })

  return {
    lines: computed(() => (query.data.value?.length ? query.data.value : FALLBACK_LINE_OPTIONS)),
    refresh: query.refresh,
  }
}
