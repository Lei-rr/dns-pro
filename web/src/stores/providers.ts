import { defineStore } from 'pinia'
import { ref } from 'vue'
import { providersApi } from '@/providers/api'
import type { Provider } from '@/types'

export const useProviderStore = defineStore('providers', () => {
  const providers = ref<Provider[] | null>(null)
  const loading = ref(false)
  const error = ref<unknown | null>(null)

  let pendingLoad: Promise<Provider[]> | null = null
  let requestToken = 0

  async function load(options: { refresh?: boolean } = {}) {
    if (options.refresh) pendingLoad = null
    if (!options.refresh && providers.value) return providers.value

    if (!pendingLoad) {
      const token = requestToken + 1
      requestToken = token
      loading.value = true
      error.value = null
      pendingLoad = providersApi
        .configured()
        .then((response) => {
          if (token !== requestToken) return providers.value || []
          providers.value = response.data
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

  return { providers, loading, error, load, clear, replace }
})

export async function loadProviders(options: { refresh?: boolean } = {}) {
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
