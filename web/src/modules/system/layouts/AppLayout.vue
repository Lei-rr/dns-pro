<template>
  <a-layout style="min-height: 100vh; background: #fff">
    <a-layout-header style="position: sticky; top: 0; z-index: 10; background: #fff; padding: 0">
      <div class="app-container app-header-inner">
        <div class="app-brand-nav">
          <router-link to="/" class="app-brand">
            <a-avatar shape="square" style="background: #1677ff">D</a-avatar>
            <a-typography-text strong style="font-size: 16px">DNS-PRO</a-typography-text>
          </router-link>
          <a-menu class="app-menu" mode="horizontal" :selected-keys="selectedKeys" :items="menuItems" @click="openMenu" />
        </div>
        <a-dropdown :trigger="['click']">
          <a-button shape="circle" title="管理" aria-label="管理">☰</a-button>
          <template #overlay>
            <a-menu @click="handleUserMenu">
              <a-menu-item key="providers">服务商</a-menu-item>
              <a-menu-divider />
              <a-menu-item key="logout" danger>退出</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </div>
    </a-layout-header>
    <a-layout-content>
      <div class="app-container app-main">
        <router-view />
      </div>
    </a-layout-content>
  </a-layout>
</template>

<script setup lang="ts">
import { computed, h, onMounted } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { authApi } from '@/modules/system/api/auth'
import { loadProviders, useProviderStore } from '@/stores/providers'
import { providerMenuEntries, selectedMenuKey } from '@/routes/utils'
import { message } from '@/shared/plugins/antDesignVue'
import { errorMessage } from '@/shared/utils/errors'
import type { Provider } from '@/types'

const route = useRoute()
const router = useRouter()
const providerStore = useProviderStore()

const selectedKeys = computed(() => [selectedMenuKey(route.path)])
const menuItems = computed(() => {
  const items: Array<{ key: string; label: unknown; path?: string }> = [
    { key: 'home', label: h(RouterLink, { to: '/' }, { default: () => '控制台' }), path: '/' },
  ]
  for (const provider of providerStore.providers || []) {
    items.push(...providerMenuEntries(provider))
  }
  return items
})
const menuPathMap = computed(() => Object.fromEntries(menuItems.value.map((item) => [item.key, item.path])))

onMounted(async () => {
  await loadProvidersSafely()
})

async function loadProvidersSafely() {
  try {
    await loadProviders()
  } catch (error) {
    message.error(errorMessage(error))
  }
}

async function logout() {
  await authApi.logout().catch(() => {})
  router.replace('/login')
}

function handleUserMenu({ key }: { key: string }) {
  if (key === 'providers') router.push('/providers')
  if (key === 'logout') logout()
}

function openMenu({ key }: { key: string }) {
  if (key === 'home') return
  const path = menuPathMap.value[key]
  if (path && path !== route.path) router.push(path)
}
</script>
