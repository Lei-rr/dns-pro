<script setup lang="ts">
import { computed } from 'vue'
import { RecordsPanel, type DnsProviderRef } from '@/features/dns'
import type { ProviderPageProps } from '../provider-entry/provider-page-props'

const props = defineProps<ProviderPageProps>()

const provider = computed<DnsProviderRef>(() => ({
  id: props.providerId,
  type: props.providerType as DnsProviderRef['type'],
  name: props.providerName,
}))
</script>

<template>
  <RecordsPanel :provider="provider" :zone-id="zoneId" />
</template>
