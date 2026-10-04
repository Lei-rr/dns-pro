<script setup lang="ts">
import { computed } from 'vue'
import { RecordsPanel, type DnsProviderRef } from '@/features/dns'
import { toDnsProviderRef } from '../provider-entry/to-dns-provider'
import type { ProviderPageProps } from '../provider-entry/provider-page-props'

const props = defineProps<ProviderPageProps>()

const provider = computed<DnsProviderRef>(() => toDnsProviderRef(props))
</script>

<template>
  <RecordsPanel :provider="provider" :zone-id="zoneId" />
</template>
