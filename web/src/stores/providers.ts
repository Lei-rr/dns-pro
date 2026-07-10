import { defineStore } from 'pinia'
import { providersApi } from '@/providers/api'
import type { Provider } from '@/types'

let providersPromise: Promise<Provider[]> | null = null
let providersRequestToken = 0

export const useProviderStore = defineStore('providers', {
  state: () => ({
    providers: null as Provider[] | null,
    loading: false,
    error: null as unknown | null,
  }),
  actions: {
    async load(options: { refresh?: boolean } = {}) {
      if (options.refresh) {
        providersPromise = null
      }
      if (!options.refresh && this.providers) return this.providers

      if (!providersPromise) {
        const requestToken = providersRequestToken + 1
        providersRequestToken = requestToken
        this.loading = true
        this.error = null
        providersPromise = providersApi
          .configured()
          .then((response) => {
            if (requestToken !== providersRequestToken) return this.providers as Provider[]
            this.providers = response.data
            return this.providers
          })
          .catch((error) => {
            if (requestToken !== providersRequestToken) return this.providers as Provider[]
            this.error = error
            throw error
          })
          .finally(() => {
            if (requestToken === providersRequestToken) {
              providersPromise = null
              this.loading = false
            }
          })
      }

      await providersPromise

      return this.providers
    },
    clear() {
      providersPromise = null
      providersRequestToken += 1
      this.providers = null
      this.error = null
      this.loading = false
    },
  },
})

export async function loadProviders(options: { refresh?: boolean } = {}) {
  return useProviderStore().load(options)
}

export function clearProvidersCache() {
  useProviderStore().clear()
}

export function replaceProvidersCache(providers: Provider[]) {
  providersPromise = null
  providersRequestToken += 1
  const store = useProviderStore()
  store.providers = providers
  store.error = null
  store.loading = false
}

export function getCachedProvider(providerId: string): Provider | null {
  return (useProviderStore().providers || []).find((provider) => provider.id === providerId) || null
}
