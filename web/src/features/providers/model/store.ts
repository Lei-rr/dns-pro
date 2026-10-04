import { defineStore } from 'pinia'
import { ref } from 'vue'
import { providersApi } from '../api/provider-api'
import type { Provider } from './types'

export const useProviderStore = defineStore('providers', () => {
  /** 已配置完整的服务商（下拉、指标、面板渲染使用） */
  const providers = ref<Provider[] | null>(null)
  /** 全部服务商（含未配置完整；路由存在性判断使用） */
  const allProviders = ref<Provider[] | null>(null)
  const loading = ref(false)
  const error = ref<unknown | null>(null)

  let pendingLoad: Promise<Provider[]> | null = null
  let requestToken = 0

  async function load(options: { force?: boolean } = {}) {
    if (options.force) pendingLoad = null
    if (!options.force && providers.value && allProviders.value) return providers.value

    if (!pendingLoad) {
      const token = requestToken + 1
      requestToken = token
      loading.value = true
      error.value = null
      pendingLoad = providersApi
        .list()
        .then((response) => {
          if (token !== requestToken) return providers.value || []
          allProviders.value = response.data
          providers.value = response.data.filter((provider) => provider.configured)
          return providers.value
        })
        .catch((err) => {
          if (token !== requestToken) return providers.value || []
          error.value = err
          throw err
        })
        .finally(() => {
          if (token === requestToken) {
            pendingLoad = null
            loading.value = false
          }
        })
    }

    return pendingLoad
  }

  function clear() {
    pendingLoad = null
    requestToken += 1
    providers.value = null
    allProviders.value = null
    error.value = null
    loading.value = false
  }

  function replace(nextProviders: Provider[]) {
    pendingLoad = null
    requestToken += 1
    providers.value = nextProviders
    error.value = null
    loading.value = false
  }

  return { providers, allProviders, loading, error, load, clear, replace }
})

export async function loadProviders(options: { force?: boolean } = {}) {
  return useProviderStore().load(options)
}

export function clearProvidersCache() {
  useProviderStore().clear()
}

export function replaceProvidersCache(providers: Provider[]) {
  useProviderStore().replace(providers)
}

export function getCachedProvider(providerId: string): Provider | null {
  return (useProviderStore().providers || []).find((provider) => provider.id === providerId) || null
}

/** 存在性判断：包含未配置完整的服务商（与列表页展示保持一致） */
export function getCachedProviderAny(providerId: string): Provider | null {
  const store = useProviderStore()
  return (store.allProviders || store.providers || []).find((provider) => provider.id === providerId) || null
}
