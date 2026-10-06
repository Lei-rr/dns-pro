import http, { unwrapList } from '@/shared/api/http'
import type { Provider, ProviderDefinition, ProviderDefinitions } from '../model/types'
import type { ApiResponse } from '@/shared/api/types'
import { encodePath } from '@/shared/lib/path'

function presentDefinitions(definitions: ProviderDefinition[]): ApiResponse<ProviderDefinitions> {
  // 标签必须按类型分组：dnspod_provider 在 EdgeOne 是「关联 DNSPod API」、在 SaaS 是「DNSPod 同步 API」，
  // 扁平合并会被后出现的类型覆盖，表单标签随之串味
  const labels: Record<string, Record<string, string>> = {}
  for (const definition of definitions) labels[definition.type] = definition.labels || {}
  return {
    code: 0,
    message: 'success',
    data: { types: definitions, labels },
  }
}

export const providerApi = {
  configured: async (): Promise<ApiResponse<Provider[]>> => {
    const response = unwrapList<Provider>(await http.get('/providers'))
    return {
      ...response,
      data: response.data.filter((provider) => provider.configured),
    }
  },
  list: async (signal?: AbortSignal): Promise<ApiResponse<Provider[]>> => {
    const response = unwrapList<Provider>(await http.get('/providers', { signal }))
    return response
  },
  definitions: async (signal?: AbortSignal): Promise<ApiResponse<ProviderDefinitions>> =>
    presentDefinitions(unwrapList<ProviderDefinition>(await http.get('/providers/definitions', { signal })).data),
  create: (data: Record<string, unknown>) => http.post('/providers', data),
  update: (provider: string, data: Record<string, unknown>) => http.put(`/providers/${encodePath(provider)}`, data),
  remove: (provider: string) => http.delete(`/providers/${encodePath(provider)}`),
  test: (provider: string) => http.post(`/providers/${encodePath(provider)}/test`),
}
