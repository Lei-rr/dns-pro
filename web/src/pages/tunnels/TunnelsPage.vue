<script setup lang="ts">
import { TunnelsPanel } from '@/features/tunnels'
import type { ProviderPageProps } from '../provider-entry/provider-page-props'

defineProps<ProviderPageProps>()
</script>

<template>
  <TunnelsPanel :provider-id="providerId" />
</template>
