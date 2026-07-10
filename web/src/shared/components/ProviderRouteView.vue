<template>
  <a-spin :spinning="loading">
    <component v-if="!loading && routeEntry && component" :is="component" v-bind="componentProps" />
  </a-spin>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useProviderStore } from '@/stores/providers'
import { resolveChildRoute, resolveEntryRoute } from '@/routes/utils'
import type { Provider, RouteEntry } from '@/types'

const props = defineProps<{
  child?: boolean
}>()

const route = useRoute()
const providerStore = useProviderStore()

const providers = computed<Provider[]>(() => providerStore.providers || [])
const loading = computed(() => providerStore.loading)
const routeId = computed(() => String(route.params.provider))
const second = computed(() => String(route.params.second || ''))
const routeEntry = computed<RouteEntry | null>(() => {
  return props.child
    ? resolveChildRoute(providers.value, routeId.value, second.value)
    : resolveEntryRoute(providers.value, routeId.value)
})
const component = computed(() => routeEntry.value?.component || null)
const componentProps = computed(() => ({ provider: routeId.value, ...(routeEntry.value?.props || {}) }))
</script>
