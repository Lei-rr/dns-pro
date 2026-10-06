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
  const version = computed(() => session.value?.version || __APP_VERSION__)

  let pendingSession: Promise<SessionState> | null = null
  let requestToken = 0

  /**
   * load / login 共用的请求收尾：token 在等待期间被刷新或失效覆盖时丢弃本次结果；
   * pending 与 loading 仅在「本次请求仍是最新且仍挂起」时复位。
   * 成功后写入登录态由 commit 提供：load 只在未认证时递增 revision，login 无条件递增，故刻意不合并。
   */
  async function runSessionRequest(
    request: () => Promise<SessionState>,
    commit: (nextSession: SessionState) => void
  ): Promise<SessionState> {
    const token = ++requestToken
    loading.value = true
    const pending = request()
    pendingSession = pending
    try {
      const nextSession = await pending
      if (token !== requestToken) return session.value || anonymousSession
      commit(nextSession)
      return nextSession
    } finally {
      if (token === requestToken && pendingSession === pending) {
        pendingSession = null
        loading.value = false
      }
    }
  }

  async function load(options: { refresh?: boolean } = {}) {
    if (options.refresh && pendingSession) {
      requestToken += 1
      pendingSession = null
    }
    if (!options.refresh && checked.value && session.value) return session.value

    if (!pendingSession) {
      // 请求失败不写入登录态：checked 保持 false，后续导航会重试
      return runSessionRequest(
        () => authApi.me().then((response) => response.data),
        (nextSession) => {
          session.value = nextSession
          checked.value = true
          if (!nextSession.authenticated) revision.value += 1
        }
      )
    }

    return pendingSession
  }

  function login(username: string, password: string) {
    return runSessionRequest(
      () => authApi.login(username, password).then((response) => response.data),
      (nextSession) => {
        session.value = nextSession
        checked.value = true
        revision.value += 1
      }
    )
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
