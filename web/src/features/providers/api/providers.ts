import http from '@/shared/api/http'
import { presentProvider } from '@/features/providers/lib/presenter'
import type { ApiResponse, Provider, ProviderDefinition, ProviderDefinitions } from '@/shared/types'
import { encodePath } from '@/shared/lib/path'


function presentDefinitions(definitions: ProviderDefinition[]): ApiResponse<ProviderDefinitions> {
  const labels: Record<string, string> = {}
  for (const definition of definitions) Object.assign(labels, definition.labels || {})
  return {
    code: 0,
    message: 'success',
    data: { types: definitions, labels },
  }
}

export const providersApi = {
  configured: async (): Promise<ApiResponse<Provider[]>> => {
    const response = await http.get<Provider[]>('/providers')
    return {
      ...response,
      data: response.data.map(presentProvider).filter((provider) => provider.configured),
    }
  },
  list: async (): Promise<ApiResponse<Provider[]>> => {
    const response = await http.get<Provider[]>('/providers')
    return { ...response, data: response.data.map(presentProvider) }
  },
  definitions: async (): Promise<ApiResponse<ProviderDefinitions>> =>
    presentDefinitions((await http.get<ProviderDefinition[]>('/providers/definitions')).data),
  create: (data: Record<string, unknown>) => http.post('/providers', data),
  update: (provider: string, data: Record<string, unknown>) => http.put(`/providers/${encodePath(provider)}`, data),
  remove: (provider: string) => http.delete(`/providers/${encodePath(provider)}`),
  test: (provider: string) => http.post(`/providers/${encodePath(provider)}/test`),
  reorder: async (order: string[]): Promise<ApiResponse<Provider[]>> => {
    const response = await http.put<Provider[]>('/providers/sort-order', { order })
    return { ...response, data: response.data.map(presentProvider) }
  },
}
