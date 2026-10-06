<script setup lang="ts">
import { computed } from 'vue'
import { SaasHostsPanel, type SaaSSyncProvider } from '@/features/saas'
import { dnsApi } from '@/features/dns'
import { isDnsPlatform, useProvidersQuery } from '@/features/providers'
import type { ProviderPageProps } from '../provider-entry/provider-page-props'

defineProps<ProviderPageProps>()

const { allProviders } = useProvidersQuery()

const syncProviders = computed<SaaSSyncProvider[]>(() =>
  allProviders.value.flatMap((item) =>
    isDnsPlatform(item.type) ? [{ id: item.id, type: item.type, name: item.name }] : []
  )
)

async function loadDnsZones(providerId: string) {
  const target = allProviders.value.find((item) => item.id === providerId)
  if (!target || !isDnsPlatform(target.type)) return []
  return (await dnsApi.zones({ id: target.id, type: target.type, name: target.name })).data
}
</script>

<template>
  <SaasHostsPanel
    :provider-id="providerId"
    :zone-name="zoneId"
    :load-dns-zones="loadDnsZones"
    :sync-providers="syncProviders"
  />
</template>
