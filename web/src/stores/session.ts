import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { authApi, type SessionState } from '@/modules/system/api/auth'
import { clearProvidersCache } from '@/stores/providers'

const anonymousSession: SessionState = {
  authenticated: false,
  username: null,
}

export const useSessionStore = defineStore('session', () => {
  const session = ref<SessionState | null>(null)
  const checked = ref(false)
  const loading = ref(false)

  const authenticated = computed(() => session.value?.authenticated === true)
  const username = computed(() => session.value?.username ?? null)

  let pendingSession: Promise<SessionState> | null = null

  async function load(options: { refresh?: boolean } = {}) {
    if (options.refresh) pendingSession = null
    if (!options.refresh && checked.value && session.value) return session.value

    if (!pendingSession) {
      loading.value = true
      pendingSession = authApi
        .me()
        .then((response) => response.data)
        .catch((error) => {
          invalidate()
          throw error
        })
        .finally(() => {
          pendingSession = null
          loading.value = false
        })
    }

    const nextSession = await pendingSession
    session.value = nextSession
    checked.value = true
    if (!nextSession.authenticated) clearProvidersCache()
    return nextSession
  }

  async function login(username: string, password: string) {
    pendingSession = null
    loading.value = true
    try {
      const response = await authApi.login(username, password)
      session.value = response.data
      checked.value = true
      clearProvidersCache()
      return session.value
    } finally {
      loading.value = false
    }
  }

  async function logout() {
    invalidate()
    await authApi.logout().catch(() => {})
  }

  function invalidate() {
    pendingSession = null
    session.value = anonymousSession
    checked.value = true
    loading.value = false
    clearProvidersCache()
  }

  return { session, checked, loading, authenticated, username, load, login, logout, invalidate }
})
