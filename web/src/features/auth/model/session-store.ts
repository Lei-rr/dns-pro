import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { authApi, type SessionState } from '../api/auth-api'

const anonymousSession: SessionState = {
  authenticated: false,
  username: null,
}

export const useSessionStore = defineStore('session', () => {
  const session = ref<SessionState | null>(null)
  const checked = ref(false)
  const loading = ref(false)
  const revision = ref(0)

  const authenticated = computed(() => session.value?.authenticated === true)
  const username = computed(() => session.value?.username ?? null)
  const isDefaultCredential = computed(() => session.value?.is_default_credential === true)
  const version = computed(() => session.value?.version || '1.0.0')

  let pendingSession: Promise<SessionState> | null = null
  let requestToken = 0

  async function load(options: { refresh?: boolean } = {}) {
    if (options.refresh && pendingSession) {
      requestToken += 1
      pendingSession = null
    }
    if (!options.refresh && checked.value && session.value) return session.value

    if (!pendingSession) {
      const token = ++requestToken
      loading.value = true
      const request = authApi.me().then((response) => response.data)
      pendingSession = request
      try {
        const nextSession = await request
        if (token !== requestToken) return session.value || anonymousSession
        session.value = nextSession
        checked.value = true
        if (!nextSession.authenticated) revision.value += 1
        return nextSession
      } catch (error) {
        if (token === requestToken) {
          session.value = anonymousSession
          checked.value = true
          revision.value += 1
        }
        throw error
      } finally {
        if (token === requestToken && pendingSession === request) {
          pendingSession = null
          loading.value = false
        }
      }
    }

    return pendingSession
  }

  async function login(username: string, password: string) {
    const token = ++requestToken
    loading.value = true
    const request = authApi.login(username, password).then((response) => response.data)
    pendingSession = request
    try {
      const nextSession = await request
      if (token !== requestToken) return session.value || anonymousSession
      session.value = nextSession
      checked.value = true
      revision.value += 1
      return nextSession
    } finally {
      if (token === requestToken && pendingSession === request) {
        pendingSession = null
        loading.value = false
      }
    }
  }

  async function logout() {
    invalidate()
    await authApi.logout().catch(() => {})
  }

  function invalidate() {
    requestToken += 1
    pendingSession = null
    session.value = anonymousSession
    checked.value = true
    loading.value = false
    revision.value += 1
  }

  return {
    session,
    checked,
    loading,
    authenticated,
    username,
    version,
    isDefaultCredential,
    revision,
    load,
    login,
    logout,
    invalidate,
  }
})
