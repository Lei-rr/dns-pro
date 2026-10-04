<script setup lang="ts">
import { EdgeOneZonesPanel } from '@/features/edge-one'
import type { ProviderPageProps } from '../provider-entry/provider-page-props'

defineProps<Pick<ProviderPageProps, 'providerId'>>()
</script>

<template>
  <EdgeOneZonesPanel :provider-id="providerId" />
</template>
