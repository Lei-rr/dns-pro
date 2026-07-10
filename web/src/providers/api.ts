import http from '@/shared/utils/request'
import { presentProvider } from './presenter'
import type { ApiResponse, Provider } from '@/types'

const endpoints = {
  configured: '/providers',
}

export const providersApi = {
  configured: async (): Promise<ApiResponse<Provider[]>> => {
    const response = await http.get<Provider[]>(endpoints.configured)
    return {
      ...response,
      data: response.data.map(presentProvider).filter((provider) => provider.configured),
    }
  },
}
