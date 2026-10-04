<script setup lang="ts">
import { TunnelDetailPanel } from '@/features/tunnels'
import type { ProviderPageProps } from '../provider-entry/provider-page-props'

defineProps<ProviderPageProps>()
</script>

<template>
  <TunnelDetailPanel :provider-id="providerId" :tunnel-id="zoneId" />
</template>
