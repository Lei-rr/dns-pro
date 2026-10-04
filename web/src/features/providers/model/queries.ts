import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { providersApi } from '../api/provider-api'
import { queryClient } from '@/shared/query'
import type { Provider } from './types'

const providersKeys = {
  all: ['providers'] as const,
}

function providersQueryOptions() {
  return {
    queryKey: providersKeys.all,
    queryFn: async (): Promise<Provider[]> => (await providersApi.list()).data,
  }
}

/** 服务商列表读路径：唯一数据源是 TanStack Query 缓存（含未配置完整的服务商）。 */
export function useProvidersQuery() {
  const query = useQuery(providersQueryOptions())
  const allProviders = computed(() => query.data.value ?? [])
  return {
    allProviders,
    providers: computed(() => allProviders.value.filter((provider) => provider.configured)),
    loading: computed(() => query.isPending.value),
    error: query.error,
    reload: () => query.refetch(),
  }
}

/** 命令式读取（路由守卫 / 启动装载）：force 时绕过本地缓存重新请求。 */
export async function loadProviders(options: { force?: boolean } = {}): Promise<Provider[]> {
  if (options.force) await queryClient.invalidateQueries({ queryKey: providersKeys.all })
  const providers = await queryClient.ensureQueryData(providersQueryOptions())
  return providers.filter((provider) => provider.configured)
}

/** 存在性判断：包含未配置完整的服务商（与列表页展示保持一致） */
export function getCachedProviderAny(providerId: string): Provider | null {
  const providers = queryClient.getQueryData<Provider[]>(providersKeys.all) ?? []
  return providers.find((provider) => provider.id === providerId) || null
}

export function clearProvidersCache() {
  queryClient.removeQueries({ queryKey: providersKeys.all })
}
