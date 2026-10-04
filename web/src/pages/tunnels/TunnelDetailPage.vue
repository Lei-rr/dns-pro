<script setup lang="ts">
import { TunnelDetailPanel } from '@/features/tunnels'
import type { ProviderPageProps } from '../provider-entry/provider-page-props'

defineProps<Pick<ProviderPageProps, 'providerId' | 'zoneId'>>()
</script>

<template>
  <TunnelDetailPanel :provider-id="providerId" :tunnel-id="zoneId" />
</template>
