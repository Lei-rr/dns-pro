<script setup lang="ts">
import { TunnelsPanel } from '@/features/tunnels'
import type { ProviderPageProps } from '../provider-entry/provider-page-props'

defineProps<Pick<ProviderPageProps, 'providerId'>>()
</script>

<template>
  <TunnelsPanel :provider-id="providerId" />
</template>
