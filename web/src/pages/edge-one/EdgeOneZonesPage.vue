<script setup lang="ts">
import { EdgeOneZonesPanel } from '@/features/edge-one'
import type { ProviderPageProps } from '../provider-entry/provider-page-props'

defineProps<ProviderPageProps>()
</script>

<template>
  <EdgeOneZonesPanel :provider-id="providerId" />
</template>
