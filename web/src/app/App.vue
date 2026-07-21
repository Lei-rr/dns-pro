<script setup lang="ts">
import { RouterView } from 'vue-router'
import { Toaster } from '@/shared/ui/sonner'
import { ConfirmHost } from '@/shared/ui/confirm'
</script>

<template>
  <RouterView />
  <!-- position only product preference; rest = official sonner defaults -->
  <Toaster position="top-center" :close-button="true" />
  <ConfirmHost />
</template>
