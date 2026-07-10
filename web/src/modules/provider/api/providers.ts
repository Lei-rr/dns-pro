import http from '@/shared/utils/request'
import { presentProvider } from '@/providers/presenter'
import type { ApiResponse, Provider, ProviderDefinitions } from '@/types'

const path = (value: string) => encodeURIComponent(value)
const endpoints = {
  providers: '/providers',
  providerDefinitions: '/providers/definitions',
  providerOrder: '/providers/sort-order',
  provider: (provider: string) => `/providers/${path(provider)}`,
}

function presentDefinitions(definitions: Array<Record<string, unknown>>): ApiResponse<ProviderDefinitions> {
  const labels: Record<string, string> = {}
  for (const definition of definitions) Object.assign(labels, (definition.labels as Record<string, string>) || {})
  return {
    code: 0,
    message: 'success',
    data: { types: definitions as unknown as ProviderDefinitions['types'], labels },
  }
}

export const providerSettingsApi = {
  providers: async (): Promise<ApiResponse<Provider[]>> => {
    const response = await http.get<Provider[]>(endpoints.providers)
    return { ...response, data: response.data.map(presentProvider) }
  },
  providerDefinitions: async (): Promise<ApiResponse<ProviderDefinitions>> =>
    presentDefinitions((await http.get<Array<Record<string, unknown>>>(endpoints.providerDefinitions)).data),
  createProvider: (data: Record<string, unknown>) => http.post(endpoints.providers, data),
  updateProvider: (provider: string, data: Record<string, unknown>) => http.put(endpoints.provider(provider), data),
  deleteProvider: (provider: string) => http.delete(endpoints.provider(provider)),
  updateProviderOrder: async (order: string[]): Promise<ApiResponse<Provider[]>> => {
    const response = await http.put<Provider[]>(endpoints.providerOrder, { order })
    return { ...response, data: response.data.map(presentProvider) }
  },
}
