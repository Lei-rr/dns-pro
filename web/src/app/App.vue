<script setup lang="ts">
import { RouterView } from 'vue-router'
import { Toaster } from '@/shared/ui/sonner'
import { ConfirmHost } from '@/shared/ui/confirm'
</script>

<template>
  <RouterView />
  <Toaster position="top-center" :close-button="true" />
  <ConfirmHost />
</template>
