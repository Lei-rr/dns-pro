import http, { unwrapItems } from '@/shared/api/http'
import type { Provider, ProviderDefinition, ProviderDefinitions } from '../model/types'
import type { ApiResponse } from '@/shared/api/types'
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
    const response = unwrapItems<Provider[]>(await http.get('/providers'))
    return {
      ...response,
      data: response.data.filter((provider) => provider.configured),
    }
  },
  list: async (): Promise<ApiResponse<Provider[]>> => {
    const response = unwrapItems<Provider[]>(await http.get('/providers'))
    return response
  },
  definitions: async (): Promise<ApiResponse<ProviderDefinitions>> =>
    presentDefinitions(unwrapItems<ProviderDefinition[]>(await http.get('/providers/definitions')).data),
  create: (data: Record<string, unknown>) => http.post('/providers', data),
  update: (provider: string, data: Record<string, unknown>) => http.put(`/providers/${encodePath(provider)}`, data),
  remove: (provider: string) => http.delete(`/providers/${encodePath(provider)}`),
  test: (provider: string) => http.post(`/providers/${encodePath(provider)}/test`),
}
