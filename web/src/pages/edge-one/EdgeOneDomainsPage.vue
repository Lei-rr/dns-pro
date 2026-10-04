<script setup lang="ts">
import { computed } from 'vue'
import { AccelerationDomainsPanel } from '@/features/edge-one'
import { useProvidersQuery } from '@/features/providers'
import type { ProviderPageProps } from '../provider-entry/provider-page-props'

const props = defineProps<ProviderPageProps>()

const { allProviders } = useProvidersQuery()

/** EdgeOne 需先关联 DNSPod 才能做 CNAME 同步；未关联时面板隐藏同步操作。 */
const dnspodLinked = computed(() => {
  const current = allProviders.value.find((item) => item.id === props.providerId)
  if (current?.type !== 'edgeone') return false
  return Boolean(String(current.dnspod_provider || current.fields?.dnspod_provider || '').trim())
})
</script>

<template>
  <AccelerationDomainsPanel :provider-id="providerId" :zone-id="zoneId" :dnspod-linked="dnspodLinked" />
</template>
